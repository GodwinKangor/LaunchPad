# LaunchPad sample app

A dependency-free Node.js HTTP server for trying out LaunchPad.

Deploy it by creating a project with:

| Field | Value |
| --- | --- |
| Repository | the GitHub URL of your fork of this repository |
| Branch | the branch that contains this folder |
| Application port | `3000` |
| Root directory (Advanced) | `sample` |
| Health check path (Advanced) | `/healthz` |

Things to try:

- Set `GREETING` under **Environment**, then **Restart**: the page changes without a rebuild.
- Set `FAIL_HEALTH=true` and **Redeploy**: the deployment fails its health check and the
  previous release keeps serving. Remove the variable and redeploy to recover.

Run it without LaunchPad: `node server.js`, or `docker build -t sample . && docker run -p 3000:3000 sample`.
