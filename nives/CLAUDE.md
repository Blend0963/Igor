# MaDo contributor notes

MaDo is a Home Assistant add-on for an AI assistant with persistent memory, conversation history, Home Assistant tools, and optional Tavily web search.

## Layout

- `nives/config.yaml`: Home Assistant add-on metadata and configuration schema. The directory name is retained for compatibility with the inherited build layout.
- `nives/Dockerfile`: multi-stage image build for the Node.js server and Shodh memory service.
- `nives/rootfs/`: s6 service definitions, configuration-to-environment mapping, and the companion Home Assistant integration.
- `server/src/home-mind-server/`: TypeScript API and LLM engine, Home Assistant tools, memory, and conversation history.
- `README.md` and `nives/DOCS.md`: user-facing documentation.

## Development

From `server/src/home-mind-server`:

```sh
npm ci
npm run build
npm test
```

The GitHub Actions workflow runs the server build and tests, then builds amd64 and aarch64 images. Images are published to `ghcr.io/blend0963/mado-{arch}` on pushes to the release branch's target branch and version tags.

## Configuration

New installs use BYOK mode. Supported providers are Anthropic, OpenAI, OpenRouter, and Ollama. `WEB_SEARCH_API_KEY` is optional; it enables the `web_search` tool using Tavily. Search results are untrusted source material and should be returned with source URLs.

The companion integration still uses the internal `nives` domain, directory, and discovery identifier for compatibility with the inherited integration layout. User-visible branding is MaDo.

## Release checklist

1. Update `version` in `nives/config.yaml` and add a changelog entry.
2. Keep `server/src/home-mind-server/package.json` and its lockfile in sync.
3. Run `npm ci`, `npm run build`, and `npm test`.
4. Verify the add-on image namespace matches `nives/config.yaml` and `.github/workflows/build.yml`.
5. Preserve the AGPL-3.0 license and all required upstream copyright and attribution notices.
