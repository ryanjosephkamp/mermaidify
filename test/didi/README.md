# Drawings people made

`test.json.gz` holds 300 drawings from the Didi dataset (Digital Ink Diagram data), by Google LLC, used under the
[Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/). The dataset
is described in Philippe Gervais, Thomas Deselaers, Emre Aksan, and Otmar Hilliges, "The DIDI dataset: Digital Ink
Diagram data" (2020),
[arXiv:2002.09303](https://arxiv.org/abs/2002.09303), and published at
[google-research/didi_dataset](https://github.com/google-research/google-research/tree/master/didi_dataset).

People drew these over flowcharts that Graphviz had laid out, with no text in the shapes. Each entry keeps:

- `key` and `label`: the drawing's key and its chart's `label_id` in the dataset;
- `strokes`: the ink, as `[x, y]` points;
- `nodes`, `edges`, and `rankdir`: the chart, from its xdot layout, placed over the ink.

The changes from the dataset: only drawings from its `test` split, the chart placed over the ink as the collection
app showed it, everything scaled so a standard node is 120 units wide, points within 2 units of the last one kept
left out, numbers rounded to a tenth, and timestamps dropped. `scripts/didi.ts` makes the file again from the
dataset; `scripts/measure.ts` scores the reader on it.
