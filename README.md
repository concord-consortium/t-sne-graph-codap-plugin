# CODAP Plugin Starter Project

This is a bare-bones React project. It contains a simple React view with the libraries for using the [CODAP Plugin API](https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-Plugin-API).

## Deployment

S3 deployment is handled by GitHub Actions using OIDC for AWS authentication. See [deploy-setup.md in starter-projects](https://github.com/concord-consortium/starter-projects/blob/main/doc/deploy-setup.md) for how the AWS side is set up, and [doc/deploy.md](doc/deploy.md) for how deploys work in this repo.

# Copying from the starter project

## Create a new repository

There are two ways to create a new repository from this template:

### Method 1: Using GitHub Template Button
1. Go to this repository's GitHub page
2. Click the green "Use this template" button at the top
3. Select "Create a new repository"
4. Set your repository name (e.g. `new-repository`)
5. Choose visibility (public/private)
6. Click "Create repository from template"
7. Clone your new repository:
   ```
   git clone https://github.com/your-username/new-repository.git
   cd new-repository
   ```

### Method 2: Using Command Line
1. Create a new public repository for your project (e.g. `new-repository`)
2. Create a clone of the starter repo
    ```
    git clone --single-branch https://github.com/concord-consortium/codap-plugin-starter-project.git new-repository
    cd new-repository
    ```
3. Next, re-initialize the repo to create a new history
    ```
    rm -rf .git
    git init
    ```
4. Add a remote to your GitHub repository
    ```
    git remote add origin https://github.com/concord-consortium/new-repository.git
    ```

## Initialize new repository

1. Run `npm install` to install dependencies
2. Optionally Run: `npm update` to update the dependencies. If you can, it is best to do this in the `codap-plugin-starter-project` first before making your new repository.
3. Run `npm start` to start the `webpack-dev-server` in development mode with hot module replacement
4. Open [localhost:8080](http://localhost:8080) (or use port 8081 if you are already using 8080). You should see a basic plugin with a heading of "CODAP Starter Plugin".

   It's ok if you see an error like `Unable to connect to CODAP: handleResponse: CODAP request timed out: [{"action":"update","resource":"interactiveFrame","values":{"name":"Sample Plugin","version":"0.0.1","dimensions":{"width":380,"height":680}}},{"action":"get","resource":"interactiveFrame"}]`. This just means that the plugin is running outside of CODAP, so is not receiving responses to API requests, which is expected. For the same reason, the buttons will show an error like `sendRequest on closed CODAP connection` in the Response area.
5. Run `npm test` to verify that the test suite still passes.
6. Run `npx playwright install` to install the playwright browsers
7. Run `npm run test:playwright` to verify the playwright tests still pass. The Playwright tests verify that the plugin works correctly inside CODAP.
8. Search and replace instances of `codap-plugin-starter-project` with `new-repository`.
9. Search and replace instances of `CODAP Starter Plugin` and `CODAP Plugin Starter Project` with `New Plugin`.
10. Update the general description of the project in the first section above.
11. Set up AWS access for S3 deployment. This is so the GitHub actions can deploy to S3 and save the Playwright results. From your new repository's root directory, run:
    ```sh
    curl -fsSL \
      https://raw.githubusercontent.com/concord-consortium/starter-projects/main/scripts/create-deploy-role.sh \
      -o /tmp/create-deploy-role.sh
    chmod +x /tmp/create-deploy-role.sh
    /tmp/create-deploy-role.sh new-repository
    ```
    Running this with your new repository as your current directory lets the script automatically fill in `role-to-assume` in `.github/workflows/ci.yml`, `playwright.yml`, and `release.yml` with the correct ARN. See [deploy-setup.md in starter-projects](https://github.com/concord-consortium/starter-projects/blob/main/doc/deploy-setup.md) for details.
12. Configure the Codecov token.
    1. Find the new repository at https://app.codecov.io/gh/concord-consortium
    2. Choose the repository token option
    3. Add the token to the GitHub repository as described on the codecov page.
13. Remove this `Copying from the starter project` section of the `README`, but keep track of the next step.
14. Create an initial commit for your new project and push it.
    ```
    git add .
    git commit -m "Initial commit"
    git push -u origin main
    ```

Your new repository is ready!

# Development

## Getting Started
1. Clone this repository and `cd` into the new folder.
2. Install the dependencies `npm install`.
3. Run the development server `npm start`.
4. Open [localhost:8080](http://localhost:8080) (or use port 8081 if you are already using 8080). You should see a basic plugin with a heading of "CODAP Starter Plugin".

   It's ok if you see an error like `Unable to connect to CODAP: handleResponse: CODAP request timed out: [{"action":"update","resource":"interactiveFrame","values":{"name":"Sample Plugin","version":"0.0.1","dimensions":{"width":380,"height":680}}},{"action":"get","resource":"interactiveFrame"}]`. This just means that the plugin is running outside of CODAP, so is not receiving responses to API requests, which is expected. For the same reason, the buttons will show an error like `sendRequest on closed CODAP connection` in the Response area.

## Testing

### Jest Tests
The project uses Jest for unit testing. To run the tests:
```
npm test
```

### Playwright Tests
The project uses Playwright for end-to-end testing. These tests verify that the plugin works correctly inside CODAP. Playwright has lots of features including a VSCode plugin. Below are some basic steps to get started.

Before running tests for the first time you need to install the Playwright browsers:
```
npx playwright install
```

After this you can run the tests without showing a browser or run them with a visible browser.

#### Run without a visible browser
```
npm run test:playwright
```
If you want to view a test report of these tests you can run:
```
npx playwright show-report
```
#### Run showing the browser
```
npm run test:playwright:open
```

### Testing in CODAP

There are two ways to test the plugin in CODAP:
- running it locally on https and use the deployed CODAP
- running it and CODAP locally on http

#### HTTPS
1. Start the plugin with `npm run start:secure`. You need to first setup a local http certificate if you haven't done so: https://github.com/concord-consortium/codap/blob/main/v3/README.md#run-using-https
2. Run CODAP v2 or v3 with the `di` parameter:
    - v2: https://codap.concord.org/app/?di=https://localhost:8080/
    - v3: https://codap3.concord.org/?di=https://localhost:8080/

#### HTTP
1. Start plugin webserver `npm start` (it will be on 8080 by default)
2. Setup a local webserver running CODAP.
    - v2: Download the latest `build_[...].zip` file https://codap.concord.org/releases/zips/. Extract the zip to a folder and run it with a local webserver. For example `npx httpserver -p 8081`
    - v3: Checkout the v3 source, install the dependencies, and start the dev server: https://github.com/concord-consortium/codap/blob/main/v3/README.md#initial-steps. The dev server should automatically choose the next avaiable port which would normally be 8081
3. Open CODAP with the plugin embedded in it: http://localhost:8081/static/dg/en/cert/index.html?di=http://localhost:8080

For further information on [CODAP Data Interactive Plugin API](https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-Plugin-API).
