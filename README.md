# Menu Lens

Menu Lens turns a photographed restaurant menu into a dated public menu. Visitors confirm publication and pass Cloudflare Turnstile before uploading. They review the original wording and prices before a background job creates a GPT Image 2.6 Flare illustration for each dish. Publishing happens once every dish image is ready. The site supports System, Light and Dark appearance settings.

## Run locally

Use Node.js 24 or newer and run `node server.mjs` from this directory. The site listens at `http://127.0.0.1:8238`. The homepage and public collection work without credentials. For a configured development deployment, pass the ignored runtime environment file with `node --env-file=.env server.mjs`.

The live runtime uses `OPENAI_API_KEY`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` and `TURNSTILE_HOSTNAME`. Optional settings are `OPENAI_IMAGE_MODEL`, `OPENAI_VISION_MODEL`, `DAILY_IMAGE_LIMIT`, `NZ_RESTAURANT_INDEX`, and `GOOGLE_PLACES_API_KEY`. The default queue limit is 120 image requests per rolling 24 hours.

The offline New Zealand restaurant search uses data from OpenStreetMap. Refresh it with `python3 tools/extract-nz-restaurants.py [geofabrik-pbf] [output-json]` in an environment with the `osmium` package. The downloadable index is licensed under ODbL 1.0. GPS comparison stays on device.

## Production

[menu.9l.nz](https://menu.9l.nz/) uses an Oracle AU container with a dedicated SQLite volume named `menu-lens-data`. Cloudflare proxies a CNAME to the existing 9L.nz tunnel. The active connector is `menu-lens-tunnel`. Its config at `~/apps/menu-lens/tunnel.yml` includes the menu route and the previous root and www rules.

Set `MENU_ORACLE_HOST` to the SSH destination and optionally `MENU_ORACLE_IDENTITY` to an SSH identity file, then run `./deploy.sh` to roll out a release. The script reads the existing Oracle configuration under `~/apps/menu-lens/private/runtime.env` on the host and reuses the SQLite volume. A failed health check restores the previous container. Verify `/healthz` and `/api/config` on the public hostname after rollout.

The homepage uses an AI-generated pappardelle photograph in `public/images/`. Restaurant listings come from published submissions.
