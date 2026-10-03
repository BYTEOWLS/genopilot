# Third-party licenses

The browser view bundles React, React DOM, Mantine, and their used dependencies locally. The build gathers each bundled npm package's license text into `dist/browser/THIRD-PARTY-LICENSES.md`, which is included in the published package.

Mantine's core, hooks, and charts packages and Recharts use the MIT license. Charts are deferred and are not yet bundled.

The npm tarball of `react-remove-scroll-bar` omits its license file. The reviewed upstream [license](https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE) is retained under `resources/licenses/` and included by the build. No license downloads happen during builds.
