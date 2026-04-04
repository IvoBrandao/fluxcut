/**
 * tests/mocks/gi.js
 *
 * Intercepts all `gi://…` and `resource:///…` bare-specifier imports so the
 * pure-logic modules in src/ can be loaded under Node.js without a real GNOME
 * Shell runtime.
 *
 * Register by passing --import to the test runner:
 *   node --test --import ./tests/mocks/gi.js tests/
 *
 * Or in package.json "test":
 *   "node --test --import ./tests/mocks/gi.js tests/"
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./gi-loader.js", pathToFileURL("./tests/mocks/gi-loader.js"));
