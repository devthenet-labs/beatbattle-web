# beatbattle-web

The browser UI of **Beat Battle**, a multiplayer step-sequencer jam. It is a stdlib-only Go server that embeds
`static/index.html`, `static/app.js` and `static/style.css` (plain JS, no build step, no npm) and serves them on
port 8080. It was scaffolded by `maul init app` so that [maul](https://github.com/devthenet-labs/maul) can build
intents in it and preview its pull requests.

## Beat Battle

People build 16-step drum patterns (kick, snare, hat), save them, vote on each other's patterns and render them to
WAV. Three repositories share one preview host, split by path prefix with no rewriting; only the browser composes
them, same-origin:

| Repository          | Prefix    | Readiness         | Role                                                          |
| ------------------- | --------- | ----------------- | ------------------------------------------------------------- |
| `beatbattle-web`    | `/`       | `/healthz`        | this repo: the UI, WebAudio playback, browsing, voting        |
| `beatbattle-api`    | `/api`    | `/api/healthz`    | patterns, votes, leaderboard, render requests (in-memory)     |
| `beatbattle-render` | `/render` | `/render/healthz` | deterministic drum synth, `POST /render/wav`                  |

The shared contract is `SPEC.md` in the parent `beatbattle` directory.

## What this service does

| Route            | Answer                                                    |
| ---------------- | ---------------------------------------------------------- |
| `/`              | `index.html`                                                |
| `/app.js`        | the UI script                                               |
| `/style.css`     | the stylesheet                                              |
| `/battles`       | `battles.html`, the battles list and start-battle form      |
| `/battles/{id}`  | `battle.html`, one battle's head-to-head page               |
| `/battles.js`    | the battles list/start-form script                          |
| `/battle.js`     | the head-to-head page's script                              |
| `/beat/{id}`     | `beat.html`, one beat's own page: its grid and battle record |
| `/beat.js`       | the beat page's script                                       |
| `/healthz`       | `{"status":"ok","revision":"<sha>"}`                        |
| anything else    | 404                                                          |

Every response carries a strict CSP (`default-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self'
data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`), so the
page has no inline script or style. The UI calls `/api/...` (save, list, vote, leaderboard) and `/render/wav`
same-origin. `ADDR` overrides the listen address (default `:8080`).

`/battles` lets two saved patterns face off: pick two, start a battle, and see the running list of battles with
their scores. `/battles/{id}` is one battle: both beats playable side by side, a vote button under each, and the
running score. Both pages call the same-origin `beatbattle-api` `/api/battles...` endpoints documented in that
repository's README; voting on a battle side also adds one vote to that pattern's normal vote count, so it also
rises on the main leaderboard.

`/beat/{id}` shows one beat's name, author, bpm, swing, score and battle record, plus its 16-step grid read only (no
play/vote controls). It calls the same-origin `GET /api/patterns/{id}` and `GET /api/patterns/{id}/record` endpoints
documented in the api repository's README.

`app.js` keeps its pure helpers (pattern to JSON and back, step timing) in a first section with no DOM access;
`node -e 'require("./static/app.js")'` loads them.

## Develop

Use Go 1.26.6.

```sh
gofmt -l .
go vet ./...
go test -race ./...
go run .
```

The root `Dockerfile` builds the runtime image a preview runs: a static binary on distroless, uid 65532, no shell,
listening on 8080. A preview runs it with a read-only root filesystem and no writable `/tmp`:

```sh
docker build -t beatbattle-web:local .
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:8080:8080 beatbattle-web:local
curl -s localhost:8080/healthz
```

`.maul/Dockerfile` is a different image: the one maul's coding agent works in, which is maul's agent base plus the
pinned Go toolchain and this module's dependencies, offline. `.maul/agent.yaml` declares its immutable tag.

## CI and images

- `test` (`ci.yml`) tests the exact head and builds the runtime image without credentials.
- `agent image` (`agent-image.yml`) builds the agent image from `main`, also without credentials.
- `publish images` (`publish-images.yml`) hands each successful build to its trusted publisher, which pushes it to ECR.
  [`.github/actions/publish/README.md`](.github/actions/publish/README.md) describes the trust boundary.

### Repository variables

None of them is secret. Set them on this repository, never on the organization: an organization variable reaches every
repository with these workflows, a template repository and its copies included. maul's reference terraform module
(`deploy/terraform/aws/modules/app`) outputs the configuration as `github_variables_dotenv`; export it from your
terraform root and set it in one command:

```sh
terraform output -raw maul_app_beatbattle_web_variables | gh variable set -f - --repo devthenet-labs/beatbattle-web
```

Set the configuration first and the two `*_PUBLISH_ENABLED` gates last:

| Variable                   | Value                                                       | What it is                                                          |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `PUBLISH_REPOSITORY_ID`    | `gh api repos/devthenet-labs/beatbattle-web --jq .id`       | this repository's immutable numeric ID, which the guard checks      |
| `PUBLISH_OWNER_ID`         | `gh api repos/devthenet-labs/beatbattle-web --jq .owner.id` | its owner's immutable numeric ID                                    |
| `AWS_REGION`               | `us-east-1`                                                 | the registry's AWS region                                           |
| `ECR_REGISTRY`             | `377946145366.dkr.ecr.us-east-1.amazonaws.com`              | the ECR registry host                                               |
| `AGENT_IMAGE_REPOSITORY`   | `maul/app-envs/beatbattle-web`                              | the agent image's ECR repository, which `.maul/agent.yaml` names    |
| `AGENT_ROLE_ARN`           | the agent publisher role ARN                                | assumed only by `publish-agent.yml`                                 |
| `AGENT_SIGNING_KEY`        | the signing key's `awskms:///` URI, or unset                | optional: the KMS key the agent image is signed with                |
| `RUNTIME_IMAGE_REPOSITORY` | `maul/previews/beatbattle-web`                              | the runtime (preview) image's ECR repository                        |
| `RUNTIME_ROLE_ARN`         | the runtime publisher role ARN                              | assumed only by `publish-runtime.yml`                               |
| `AGENT_PUBLISH_ENABLED`    | `true`                                                      | publishes the agent image; anything else skips it                   |
| `PREVIEW_PUBLISH_ENABLED`  | `true`                                                      | publishes runtime images; set it last, once previews are configured |

### Trusted workflows

Only these two workflows assume an AWS role, and each role trusts only its own workflow at `main`:

| Trusted workflow (`job_workflow_ref`)                                                 | Assumes            | Publishes                                                                            |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `devthenet-labs/beatbattle-web/.github/workflows/publish-runtime.yml@refs/heads/main` | `RUNTIME_ROLE_ARN` | the runtime image as `sha-<commit>`, and `main-<commit>` for a default-branch commit |
| `devthenet-labs/beatbattle-web/.github/workflows/publish-agent.yml@refs/heads/main`   | `AGENT_ROLE_ARN`   | the agent image as the `toolchain-v<N>` tag `.maul/agent.yaml` declares              |

### Changing the agent toolchain

Edit `.maul/Dockerfile` (or the dependencies in `go.mod`) and bump the `toolchain-v<N>` tag in `.maul/agent.yaml` in
the same commit: published tags are immutable, so a changed image needs a new tag.
