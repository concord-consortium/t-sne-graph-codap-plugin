# t-SNE Graph CODAP Plugin

The t-SNE Graph CODAP Plugin creates a graph that transforms large multidimensional data such as those found in AI language models into a 2d graph with ‘arbitrary’ axes that are easier for humans to read.

## How the plot is made

The plugin reads the chosen Phrase Column from a CODAP table and turns each phrase into numbers with TF-IDF: a count of each word, weighted by how rare the word is across the table, as scikit-learn's `TfidfVectorizer` does. It then runs t-SNE on those numbers in a Web Worker, which places phrases with similar words near each other on a 2D plot; the random seed is saved with the CODAP document, so a saved document reopens with the same picture.

Each label in the Label Column gets a color in the order it first appears in the table: the four colors from the design spec, then four placeholder colors, then a generated color for each further label, so labels get different colors (up to 424 labels; past that, colors can repeat). Labels that differ only in capitalization or spacing count as one label, and rows with an empty label (or no Label Column) are gray "Unlabeled". Clicking a point or a Key label selects the matching cases in CODAP, and selecting cases in CODAP selects their points.

Students can add up to five phrases of their own in the Test Phrases fields, which can be used once the plot is drawn. When a field loses focus, or on Enter, the plugin turns the phrase into numbers with the same TF-IDF vocabulary as the table and finds the table phrase that is most like it. The phrase's symbol is drawn 18px from that phrase's dot, in a direction set by the saved seed, so it lands in the same place each time the document is opened; the rest of the plot doesn't change. If another dot, or an earlier test phrase's symbol, is in the way, the symbol moves around the dot to the nearest place that is at least 18px from everything else. A phrase that is exactly a table phrase (ignoring capital letters and extra spaces, but not punctuation) goes instead right under that phrase's dot. The same phrase in several fields always stacks in one place, with the first field's symbol on top: under its dot if it is a table phrase, and otherwise where the first field's symbol is. Any other phrase that shares no words with the table gets no point; its field is highlighted, and says why to screen readers and in a tooltip. Test phrases are saved with the document but never added to the CODAP table, so selecting one selects only its point.

The three buttons in the top-left corner of the graph area zoom in, zoom out and fit all. Each zoom step makes the picture 1.5 times larger or smaller around the center of the plot, from one step smaller than the whole plot up to about 26 times larger; the dots and symbols keep their size, and the grid moves with them. Dragging the plot's background moves the view (with a mouse or a finger), and when a point gets keyboard focus off the plot, the view moves just enough to show it. Fit all shows the whole plot again. The view is saved with the document, and it goes back to the whole plot when a different table or Phrase Column is chosen or a new layout replaces the one shown.

Hovering over a point, giving it keyboard focus or tapping it shows a point tooltip with the point's phrase, in the point's label color, so students can read the phrase behind any point. The mouse or finger picks the point whose center is nearest, so a dot partly covered by another can still be reached, and the hovered point is drawn on top. Screen readers don't read the tooltip, because each point's name already includes its phrase.

The plugin's starting size, 680 × 300, is also its smallest size. When the tile is made smaller, the plugin keeps that size and the tile shows scrollbars, so the plot is never smaller than 300 × 300.

The ⓘ button at the top right of the panel opens "Information: t-SNE Plots", a page that explains what a t-SNE plot is and how to read it. The page opens in a CODAP tile of its own, just right of the plugin, which can be moved, resized and closed like any other tile and is saved with the document. Clicking ⓘ again brings that tile to the front instead of opening another one. The text content is in `src/info.html`.

## Deployment

S3 deployment is handled by GitHub Actions using OIDC for AWS authentication. See [deploy-setup.md in starter-projects](https://github.com/concord-consortium/starter-projects/blob/main/doc/deploy-setup.md) for how the AWS side is set up, and [doc/deploy.md](doc/deploy.md) for how deploys work in this repo.

The build makes two pages, `index.html` (the plugin) and `info.html` (the information page), which ship side by side in each build's folder. A release copies only `index-top.html` to the top level, so the build writes `info.html`'s address into a `t-sne-info-page` meta tag in each plugin page. `npm run build` checks the built pages afterward (`scripts/check-build.js`).

## Development

### Getting Started
1. Clone this repository and `cd` into the new folder.
2. Install the dependencies `npm install`.
3. Run the development server `npm start`.
4. Open [localhost:8080](http://localhost:8080) (or use port 8081 if you are already using 8080). You should see the plugin's layout: an empty grid on the left with the zoom buttons (disabled) in the top-left corner of the graph area and, on the right, the Data Table, Phrase Column and Label Column dropdowns with the ⓘ button beside them, and the Key heading and the five Test Phrases fields (disabled) below them.

   Outside CODAP the Data Table list stays empty, and after several seconds the console shows an error that starts with `Unable to connect to CODAP:`. This is expected: the plugin tries to connect three times, then stops. The ⓘ button opens nothing outside CODAP; the console shows a warning instead. To use the plugin, open it in CODAP (see [Testing in CODAP](#testing-in-codap)).
5. The information page is at [localhost:8080/info.html](http://localhost:8080/info.html). Opened on its own, it shows the text, and after a few seconds the console shows a warning that starts with `The information page could not connect to CODAP:`, which is expected.

### Known limitations
- A selected test phrase stays selected when the selection is cleared from another CODAP component, such as a graph. CODAP's selection notices don't say where a change came from, so the plugin can't tell that clear from its own. Clicking empty space in the plot, a Key label, a point that isn't selected, or a table row clears it.
- In a crowded area, where no place 18px from the nearest phrase's dot is clear of every other dot, a test phrase's symbol goes to the place with the most room and can touch another dot.
- Two points at exactly the same spot (the same phrase twice, say) can be reached with the mouse or a finger only at the one on top; the keyboard reaches both.
- Changing a dropdown or a test phrase, zooming or panning doesn't mark the CODAP document as changed, so on its own it doesn't trigger CODAP's autosave or its unsaved-changes warning. The change is saved with the document's next save. The plugin tells CODAP when its state changes, but CODAP v3 doesn't act on that yet.

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

##### Run only the speed test
The speed test (tagged `@performance`) runs in its own project, after all other tests, so no other browser shares the CPU. To run only it:
```
npx playwright test --project=performance --no-deps
```

##### Run one spec file
The tests are split into one spec file per feature in `playwright/`. To run one file:
```
npx playwright test playwright/tooltips.spec.ts
```
For `plot-and-key.spec.ts`, add `--no-deps`. That file holds the speed test, so without `--no-deps` Playwright runs all the other tests first, because the `performance` project depends on them.

##### Test fixtures
The end-to-end tests use two CODAP v3 documents in `playwright/fixtures/`:
- `hierarchical.codap`: a two-level table (Labels > Phrases) with 9 phrases in 3 labels.
- `flat.codap`: a one-level table with 40 phrases (13 each Similar, Opposite and Sideways, and one with no label), for a realistic plot and a timing check.

Each is built through the CODAP plugin API, then reopened and checked, by its script (Node 22.18 or later); the shared steps are in `fixture-builder.ts`:
```
node playwright/fixtures/build-hierarchical.ts
node playwright/fixtures/build-flat.ts
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
