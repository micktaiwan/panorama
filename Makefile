dev:
	npm run dev:desktop:4000

web:
	npm run dev:meteor:4000

test:
	npm test

help:
	@echo "make dev    - Electron + Meteor (port 4000)"
	@echo "make web    - Meteor uniquement (port 4000)"
	@echo "make test   - Lancer les tests"
