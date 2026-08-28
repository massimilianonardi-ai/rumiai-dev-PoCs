# Sessioni PoC 004

Ogni esecuzione reale della suite deve creare una directory di sessione separata e registrare almeno:

```text
environment.md
procedure.md
output.txt
result.md
```

La sessione deve indicare esplicitamente:

- repository e commit prodotto sottoposti a test;
- host/OS/architettura;
- implementazione di `/bin/sh` e Bash, se presente;
- output integrale di `tests/run`;
- eventuali `SKIP`, failure o differenze host-specifiche;
- conferma che il checkout prodotto originale sia rimasto invariato.
