# Repository coding instructions

## Style references

Use the [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
as the JavaScript style baseline and
[PEP 8](https://peps.python.org/pep-0008/) as the Python style baseline.
These instructions specify the repository's adaptations; do not copy the guides
into the repository or introduce their build dependencies.

Airbnb is a widely adopted JavaScript guide and had approximately 148,000 GitHub
stars when compared on 2026-11-01, versus approximately 29,400 for
[StandardJS](https://github.com/standard/standard) and 39,800 for
[Google's multi-language style guides](https://github.com/google/styleguide).
Stars are a visibility signal, not a definitive measure of adoption. PEP 8 is
Python's official style reference rather than a competing third-party guide.
[Google's Python guide](https://google.github.io/styleguide/pyguide.html) is
another widely used reference.

## Naming: mandatory in every language

**Never use Hungarian notation except in C and C++.** C and C++ are the only
languages in which it is permitted, not required. This prohibition applies to
variables, parameters, fields, callbacks, globals, tests, and examples, including
JavaScript embedded in HTML and Python embedded in test scripts.

Names must describe purpose, not encode type or storage scope. Do not use
prefixes such as `sz`, `str`, `n`, `i`, `d`, `f`, `b`, `rg`, `arr`, `obj`, `fn`,
`g_`, or `m_` to mean string, integer, float, boolean, collection, object,
function, global, or member. For example, use `tileCount` / `tile_count`,
`name`, `points`, and `isVisible` / `is_visible`, not `nTileCount`, `szName`,
`rgPoints`, or `fVisible`. Adding a type suffix is not a substitute.
Ordinary words beginning with those letters are fine; meaningful mathematical
coordinates such as `x`, `y`, `q`, and `r` are also fine.

Use descriptive names to distinguish values: `tile` versus `tileIndex`,
`points` versus `pointCount`, or `point` versus `pointSide`. Do not replace
removed prefixes with arbitrary numbers or permit renaming to shadow a used
binding or a language built-in.

## JavaScript

- Use `camelCase` for variables, parameters, functions, methods, and internal
  object properties. Use `PascalCase` for classes and constructors.
- Use `UPPER_SNAKE_CASE` for fixed module-level constants; `const` alone does
  not make a mutable object or local value an uppercase constant.
- Prefer `const`; use `let` only for reassignment, never `var`.
- Use two-space indentation, semicolons, single-quoted strings, template
  literals for interpolation, strict equality, and braces for control blocks.
  Prefer one declaration per statement and trailing commas in multiline
  literals. Keep changes focused rather than reformatting unrelated code.
- Preserve documented external names: browser/Node APIs, HTML IDs,
  `globalThis.RpgMap` and its `data-module` namespace keys, and serialized file
  schemas. These are contracts, not permission to create new non-idiomatic
  variable bindings. Alias an external name to an idiomatic local binding.
- Keep the editor a single self-contained HTML file with native browser APIs.
  Do not adopt Airbnb's transpilation, polyfill, framework, or package setup.
  Each `<script data-module="Name">` registers one frozen namespace object.
  Modules using the DOM must have `data-dom="true"`; other modules stay DOM-free.

## Python

- Use `snake_case` for variables, parameters, functions, methods, and modules;
  `CapWords` for classes; and `UPPER_SNAKE_CASE` for module-level constants.
- Use four-space indentation, spaces rather than tabs, and two blank lines
  between top-level definitions. Aim for PEP 8's 79-character code lines and
  72-character comments/docstrings; avoid unrelated formatting churn.
- Group imports at the top: standard library, third-party, then local imports,
  with blank lines between groups. Prefer explicit imports, not wildcard imports.
- Use `is None` / `is not None`, context managers for resources, specific
  exceptions, and descriptive docstrings for public helpers. Keep existing
  standard-library-only tools dependency-free.
- Preserve library-defined names (for example, `unittest.TestCase` methods),
  CLI arguments, and JSON/SVG schemas; do not preserve legacy Hungarian names
  for repository-owned helpers.

## Verification and compatibility

Update all callers, internal property lookups (including string-based lookups),
tests, and documentation when renaming. Preserve persisted data and deterministic
output; handle compatibility explicitly at a serialization boundary when needed.
Never change projection geometry or hand-edit generated reference exports.

Run the checks relevant to the change:

```sh
node --test tests/
python3 -m unittest discover -s tests -p 'test_*.py'
node tools/make_sample_maps.cjs --check
python3 tools/generate_map_projection.py --labels --check
```

For browser changes, also exercise the editor and check for console errors.
