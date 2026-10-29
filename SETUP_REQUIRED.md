# Setup required from the repository owner

The game is live at **https://pump-casino.onrender.com**. It was created from `render.yaml` in
your Render workspace, and the checks in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) passed on
the live service. Nothing else is needed to keep the demo running for now. The items below are
your decisions; none was made for you, and no paid plan was chosen.

## 1. The free database expires on 2026-11-28 (decide before then)

Render's free PostgreSQL expires 30 days after creation. It is then deleted after a 14-day
grace period, together with every player, round and ledger entry. It also has no backups.
Either:

- **Upgrade** `pump-postgres` to a paid instance in the Render dashboard (from about $6 a
  month), which keeps the data and adds backups; or
- **Let it expire** and create a fresh database later. Do that by deleting the Blueprint's
  resources and applying `render.yaml` again from **Blueprints → New Blueprint Instance**.
  Every player starts again with $10,000.

## 2. Optional: deploy automatically on push

The Blueprint was created from the public repository URL, so Render isn't connected to your
GitHub account and doesn't see pushes. Until it is, deploy a change by hand:

- **Blueprints → `pump-casino` → Manual sync**, for changes to `render.yaml`. Then approve the
  listed changes.
- **`pump-casino` → Manual Deploy → Deploy latest commit**, for code.

To deploy every push automatically, connect GitHub in Render's account settings and give
Render's GitHub app access to `brendonmehdi/Pump-Casino`. The Blueprint already asks for
deploys on commit, and docs-only changes are filtered out.

## 3. Optional: no cold starts

The free web service sleeps after 15 minutes without traffic, so the next visit takes about a
minute. A paid instance type (Starter, about $7 a month) stays awake.

## 4. Higgsfield generation (optional; not needed)

- **Account and spending.** Plus plan, 88.37 credits (checked read-only on 2026-10-29). No
  credits were spent.
- **Why it isn't used.** Its game/website builder runs on Higgsfield's own platform. It can't
  host this project's server-authoritative API and PostgreSQL wallet (see `docs/ASSETS.md`).
- **What the project uses instead.** All visuals and sounds are original SVG/CSS and
  synthesised Web Audio. If you'd like generated background art anyway, give approval and a
  credit budget; nothing will be generated without it.

## Railway

Railway was the original target, but it wasn't available for a new account, so the deployment
moved to Render. `railway.json` was removed, and nothing else depended on Railway.
