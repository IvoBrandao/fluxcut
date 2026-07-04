EXTENSION_UUID = fluxcut@gnome-tiling
INSTALL_DIR    = $(HOME)/.local/share/gnome-shell/extensions/$(EXTENSION_UUID)
SCHEMA_DIR     = schemas
PO_DIR         = po
LOCALES        = es fr de it pt

.PHONY: all schemas po build install enable disable uninstall dev dist clean test lint typecheck setup-tools

all: schemas po

# ── Install build/test toolchain (Ubuntu/Debian & CachyOS/Arch) ──────────────
# Installs everything needed to build, install and test the extension:
#   glib-compile-schemas (schemas), msgfmt/xgettext (translations),
#   gnome-extensions (enable/disable), zip (dist), make, node/npm (tests).
setup-tools:
	@if command -v apt-get >/dev/null 2>&1; then \
		echo "→ Detected Ubuntu/Debian (apt)"; \
		sudo apt-get update && \
		sudo apt-get install -y \
			make git zip \
			libglib2.0-bin gettext \
			gnome-shell-extensions \
			nodejs npm; \
	elif command -v pacman >/dev/null 2>&1; then \
		echo "→ Detected CachyOS/Arch (pacman)"; \
		sudo pacman -Sy --needed --noconfirm \
			make git zip \
			glib2 gettext \
			gnome-shell \
			nodejs npm; \
	else \
		echo "Unsupported distro: install these manually →"; \
		echo "  glib2 (glib-compile-schemas), gettext, gnome-shell,"; \
		echo "  zip, make, git, nodejs, npm"; \
		exit 1; \
	fi
	@echo "✓ Toolchain ready. Next: 'make node_modules' then 'make test'."


# ── Compile GSettings schemas ────────────────────────────────────────────────
schemas:
	glib-compile-schemas $(SCHEMA_DIR)/

# ── Compile translations ─────────────────────────────────────────────────────
po:
	@for lang in $(LOCALES); do \
		echo "  [msgfmt] $$lang"; \
		msgfmt $(PO_DIR)/$$lang.po -o $(PO_DIR)/$$lang.mo 2>/dev/null || true; \
	done

# Pull translatable strings from source into the POT template
pot:
	xgettext --from-code=UTF-8 -L JavaScript \
		--keyword=_ --keyword=ngettext:1,2 \
		--package-name="FluxCut" \
		--output=$(PO_DIR)/fluxcut.pot \
		extension.js prefs.js src/*.js

# ── Build: copy everything needed into a staging tree under ./build/ ─────────
build: schemas po
	@rm -rf build/$(EXTENSION_UUID)
	@mkdir -p build/$(EXTENSION_UUID)
	@cp extension.js prefs.js metadata.json stylesheet.css build/$(EXTENSION_UUID)/
	@cp -r src/ build/$(EXTENSION_UUID)/src/
	@cp -r schemas/ build/$(EXTENSION_UUID)/schemas/
	@for lang in $(LOCALES); do \
		mkdir -p build/$(EXTENSION_UUID)/locale/$$lang/LC_MESSAGES; \
		[ -f $(PO_DIR)/$$lang.mo ] && \
			cp $(PO_DIR)/$$lang.mo build/$(EXTENSION_UUID)/locale/$$lang/LC_MESSAGES/fluxcut.mo || true; \
	done

# ── Install ──────────────────────────────────────────────────────────────────
install: build
	@mkdir -p $(INSTALL_DIR)
	@cp -r build/$(EXTENSION_UUID)/. $(INSTALL_DIR)/
	@echo "Installed to $(INSTALL_DIR)"
	@echo ""
	@echo "GNOME Shell only detects new extensions after a reload:"
	@if [ "$$XDG_SESSION_TYPE" = "wayland" ]; then \
		echo "  Wayland session → log out and back in, then: make enable"; \
	else \
		echo "  X11 session → press Alt+F2, type 'r', Enter (or: killall -3 gnome-shell)"; \
		echo "  then: make enable"; \
	fi

enable:
	gnome-extensions enable $(EXTENSION_UUID)

disable:
	gnome-extensions disable $(EXTENSION_UUID)

uninstall: disable
	@rm -rf $(INSTALL_DIR)
	@echo "Uninstalled $(EXTENSION_UUID)"

# ── Dev: install + enable + tail logs ────────────────────────────────────────
dev: install enable
	@echo "--- FluxCut dev mode: tailing logs (Ctrl‑C to stop) ---"
	@journalctl -f -o cat | grep --line-buffered '\[FluxCut\]'

# ── Dist: create installable zip ─────────────────────────────────────────────
dist: build
	@cd build && zip -r ../$(EXTENSION_UUID).zip $(EXTENSION_UUID)/
	@echo "Created $(EXTENSION_UUID).zip"

# ── Clean ────────────────────────────────────────────────────────────────────
clean:
	@rm -rf build/ $(EXTENSION_UUID).zip
	@rm -f $(PO_DIR)/*.mo

# ── Tests (Node.js built-in runner, no external runtime required) ─────────────
test:
	node --test --import ./tests/mocks/gi-loader.js tests/*.test.js

# Shortcut: install deps then run tests
test-ci: node_modules
	node --test --import ./tests/mocks/gi-loader.js tests/*.test.js

node_modules: package.json
	npm install

# ── Lint / type-check (optional, requires npm install) ───────────────────────
lint:
	npx eslint extension.js prefs.js src/

typecheck:
	npx tsc --noEmit
