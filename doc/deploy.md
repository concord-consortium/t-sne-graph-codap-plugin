# Deployment

S3 deployment is handled by GitHub Actions. Pushes are deployed under `models-resources/codap-plugin-starter-project/` by the `s3-deploy` job in [`ci.yml`](../.github/workflows/ci.yml). The Playwright test report is uploaded to `models-resources/codap-plugin-starter-project/playwright-report/...` by [`playwright.yml`](../.github/workflows/playwright.yml).

## Releasing

A release promotes an existing tagged build to the top level. Nothing is rebuilt, so the exact build you tested is what gets released.

1. Push a git tag, for example `v1.2.0`. The `s3-deploy` job in `ci.yml` builds it and uploads it to `models-resources/codap-plugin-starter-project/version/v1.2.0/`.
2. Test that build in CODAP: `https://codap3.concord.org/?di=https://models-resources.concord.org/codap-plugin-starter-project/version/v1.2.0/index.html`
3. In GitHub, open **Actions → Release → Run workflow** and enter the tag. The [`release.yml`](../.github/workflows/release.yml) workflow copies `version/v1.2.0/index-top.html` to `codap-plugin-starter-project/index.html`.

The released plugin is then available at `https://models-resources.concord.org/codap-plugin-starter-project/index.html`.

`index-top.html` loads its JavaScript and CSS from the version folder, so assets must be referenced through `import` statements rather than hard-coded relative paths. See [deploy.md in starter-projects](https://github.com/concord-consortium/starter-projects/blob/main/doc/deploy.md#index-tophtml) for details.

## AWS Access

The GitHub actions in this project are allowed to update files in S3 using OIDC. An IAM role has been created in AWS with a trust policy that allows GitHub actions in this specific repository to assume this IAM role. The IAM role has a `RepoName` tag and a managed policy that uses this tag to give the role's users permission to update files in `models-resources/[RepoName]`.

See [deploy-setup.md in starter-projects](https://github.com/concord-consortium/starter-projects/blob/main/doc/deploy-setup.md) for how the AWS side is set up.
