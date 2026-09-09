Eval dumps, PDF corpus, and bench JSON are not on this branch.

They bloated every clone (~29MB). Check them out from the last commit that still had them:

```
git checkout ba30b35 -- .eval
```

Or keep a local copy. Scripts under `scripts/pdf-*.ts` still write here when you run a bench.
