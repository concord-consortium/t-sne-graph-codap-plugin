# t-SNE Graph CODAP Plugin

The t-SNE Graph CODAP Plugin creates a graph that transforms large multidimensional data such as those found in AI language models into a 2d graph with ‘arbitrary’ axes that are easier for humans to read.

## Deployment

S3 deployment is handled by GitHub Actions using OIDC for AWS authentication. See [deploy-setup.md in starter-projects](https://github.com/concord-consortium/starter-projects/blob/main/doc/deploy-setup.md) for how the AWS side is set up, and [doc/deploy.md](doc/deploy.md) for how deploys work in this repo.

## Development

### Getting Started
1. Clone this repository and `cd` into the new folder.
2. Install the dependencies `npm install`.
3. Run the development server `npm start`.
4. Open [localhost:8080](http://localhost:8080) (or use port 8081 if you are already using 8080). You should see the plugin's layout: an empty graph area on the left and, on the right, the Data Table, Phrase Column and Label Column dropdowns.

   Outside CODAP the Data Table list stays empty, and after several seconds the console shows an error that starts with `Unable to connect to CODAP:`. This is expected: the plugin tries to connect three times, then stops. To use the plugin, open it in CODAP (see [Testing in CODAP](#testing-in-codap)).

### Known limitations
- Changing a dropdown doesn't mark the CODAP document as changed, so on its own it doesn't trigger CODAP's autosave or its unsaved-changes warning. The selections are saved with the document's next save. CODAP v3 doesn't yet let a plugin mark the document as changed.

### Testing

#### Jest Tests
The project uses Jest for unit testing. To run the tests:
```
npm test
```

#### Playwright Tests
The project uses Playwright for end-to-end testing. These tests verify that the plugin works correctly inside CODAP. Playwright has lots of features including a VSCode plugin. Below are some basic steps to get started.

Before running tests for the first time you need to install the Playwright browsers:
```
npx playwright install
```

After this you can run the tests without showing a browser or run them with a visible browser.

##### Run without a visible browser
```
npm run test:playwright
```
If you want to view a test report of these tests you can run:
```
npx playwright show-report
```
##### Run showing the browser
```
npm run test:playwright:open
```

##### Test fixtures
`playwright/fixtures/hierarchical.codap` is a CODAP v3 document with a two-level table, used by the end-to-end tests. To rebuild it, and check it in CODAP, run (Node 22.18 or later):
```
node playwright/fixtures/build-hierarchical.ts
```

#### Testing in CODAP

There are two ways to test the plugin in CODAP:
- running it locally on https and use the deployed CODAP
- running it and CODAP locally on http

##### HTTPS
1. Start the plugin with `npm run start:secure`. You need to first setup a local http certificate if you haven't done so: https://github.com/concord-consortium/codap/blob/main/v3/README.md#run-using-https
2. Run CODAP v3 with the `di` parameter:
    - v3: https://codap.concord.org/app/?di=https://localhost:8080/

##### HTTP
1. Start plugin webserver `npm start` (it will be on 8080 by default)
2. Setup a local webserver running CODAP.
    - v3: Checkout the v3 source, install the dependencies, and start the dev server: https://github.com/concord-consortium/codap/blob/main/v3/README.md#initial-steps. The dev server should automatically choose the next avaiable port which would normally be 8081
3. Open CODAP with the plugin embedded in it: http://localhost:8081/?di=http://localhost:8080

For further information on [CODAP Data Interactive Plugin API](https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-Plugin-API).
