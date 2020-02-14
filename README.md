# columbus-cli
 Naive implementation of a Blockchain visualizer

There are actually 4 differents "index.js" in `src/`:

- index.ts: The latest and finest version of the blockchain visualizer
- index1.ts: A version that was done before the implementation of
  streams. Thus it uses the "getSkipblock" service.
- index2.ts: A less complete version of index.ts, which does not use
  Observable.
- index3.ts: Based on index2.ts, this version does a benchmark using
  different page sizes and saves the result as a csv file.

Run with `npm install && npm bundle`

![preview](docs/preview.png)
