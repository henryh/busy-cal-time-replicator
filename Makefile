.PHONY: install login create push pull deploy open

install:
	npm install

login:
	npx clasp login

create:
	npx clasp create

push:
	npx clasp push

pull:
	npx clasp pull

deploy:
	npx clasp deploy

open:
	npx clasp open-script
