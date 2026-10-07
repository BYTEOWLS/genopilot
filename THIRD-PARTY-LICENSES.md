# Third-party licenses

GenoPilot's build bundles its dependencies into its own files: the CLI with Ink, React, and their dependencies into `dist/cli.js`, and the browser view with React DOM, Mantine, and IGV into `dist/browser/assets/`. The build gathers each bundled npm package's license text into `dist/THIRD-PARTY-LICENSES.md`, which is included in the published package.

Mantine's core, hooks, and charts packages and Recharts use the MIT license. Charts are deferred and are not yet bundled.

The npm tarballs of `react-remove-scroll-bar` and `yoga-layout` omit their license files. The reviewed upstream licenses ([react-remove-scroll-bar](https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE), [yoga-layout](https://github.com/facebook/yoga/blob/v3.2.1/LICENSE)) are retained under `resources/licenses/` and included by the build. No license downloads happen during builds.
