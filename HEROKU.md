Heroku deployment notes for devinelamusique

Prerequisites
- Install the Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli
- Have git and an account (heroku login)

Quick deploy (git method)
1. Login to Heroku from your shell:

```powershell
heroku login
```

2. Create a Heroku app (or use an existing name):

```powershell
heroku create my-app-name
```

3. Push your branch to Heroku (this will run the build on Heroku):

```powershell
git push heroku main
```

4. Open the app in a browser:

```powershell
heroku open
```

Env vars
- Set any required environment variables with:

```powershell
heroku config:set KEY=value
```

Logs
- Stream logs while debugging:

```powershell
heroku logs --tail
```

Local testing with the same start command
- Build locally and run the start script which reads $PORT from environment.

```powershell
npm run build; $env:PORT=3000; npm run start
```

Notes
- package.json includes an `engines.node` entry to pin Node.js 20.
- The `Procfile` runs `npm run start` which uses `next start -p $PORT`.
- Heroku will run the `heroku-postbuild` script to trigger `npm run build` during deployment.
