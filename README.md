# Menu Lens

Turn a photo of a restaurant menu into a public, dated menu with an AI illustration for every dish. Diners review the original names, descriptions and printed prices before publishing. [Open Menu Lens](https://menu.9l.nz/)

[![Menu Lens homepage with a bowl of pappardelle](docs/screenshots/home.jpg)](https://menu.9l.nz/)

**Upload photos → confirm the restaurant → review the menu → publish**

You can close the tab after uploading. Return in the same browser within 24 hours to review the draft. Menus with a photo for every dish stop after reading. Approved menus appear at the same link with the original photos in a collapsed section. [Your submissions](https://menu.9l.nz/submissions)

| Choose a theme | Browse a published menu |
| :---: | :---: |
| <img src="docs/screenshots/appearance.jpg" width="300" alt="Mobile theme picker with System selected and Light and Dark available"> | <img src="docs/screenshots/published-menu.jpg" width="300" alt="Published menu on a phone showing illustrated dishes and printed prices"> |

<details>
<summary><strong>Run, test and deploy</strong></summary>

Use Node.js 24 or newer. The homepage and public collection run without credentials.

```sh
node server.mjs   # http://127.0.0.1:8238
node --test
```

| Task | Configuration |
| --- | --- |
| Enable generation | Set `OPENAI_API_KEY`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` and `TURNSTILE_HOSTNAME` in `.env`. Run `node --env-file=.env server.mjs`. |
| Connect storage | Deploy `storage/wrangler.jsonc` with its private R2 bucket. Set the same random secret as `STORAGE_SECRET` on the Worker and `R2_GATEWAY_SECRET` on the server. Set `R2_GATEWAY_URL` to the Worker route, including its trailing slash. |
| Configure AI | Open `/admin` to choose an image model, adjust quality and review private per-generation cost and IP history. The server reads `ADMIN_PIN_VERIFIER` from its private environment. |
| Runtime defaults | `OPENAI_IMAGE_MODEL=gpt-image-2.6-sunburst` at high quality, `OPENAI_VISION_MODEL=gpt-5-mini` with high reasoning, `DAILY_IMAGE_LIMIT=120`. |
| Find restaurants | Set `NZ_RESTAURANT_INDEX` or `GOOGLE_PLACES_API_KEY`. GPS comparisons stay on the device. |
| Deploy to Oracle | Set `MENU_ORACLE_HOST` and optionally `MENU_ORACLE_IDENTITY`, then run `./deploy.sh`. Cloudflare Tunnel serves the site. SQLite stores records in `menu-lens-data`. Cloudflare R2 stores originals, dish images, site assets and the restaurant index. |

The New Zealand restaurant index uses OpenStreetMap data under the ODbL. Rebuild it with `tools/extract-nz-restaurants.py` and Python’s `osmium` package. [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

</details>
