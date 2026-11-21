// csv-reader-speed-01: a dependency-free port of make.fun's csv-reader 1.0.0's readCsv.
//
// The reference reads one character at a time and concatenates every field character
// by character. This version makes the same single left-to-right pass but scans with
// charCodeAt and cuts fields out with slice(): quotes, line breaks and stray CRs are
// the only characters that need special treatment. Both field scanners are inlined
// into the record loop, so there is no per-field function call, closure-slot write or
// result object. Escapes inside quoted fields are decoded by appending slices (no
// parts array or join); ordinary fields cost one slice each. Everything is local to
// run(), so calls are pure and independent.

/** Field end: 0 = comma (record goes on), 1 = line break (record ends), 2 = end of text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** One CSV input {text, header} -> {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const n = text.length;
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0; // drop a leading BOM
  let line = 1;
  // The record being read: the line it starts on and its index in rows (null: header).
  let recordLine = 1;
  let recordRow = null;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let nf = 0;
    let lastQuoted = false; // the reference's `quoted` flag of the last field read

    for (;;) {
      let value = '';
      let initial = ''; // prefix from an unterminated quote or junk after a closing one
      let ended = END;
      let needUnquoted = true;
      let junkCase = false;
      const fieldQuoted = text.charCodeAt(pos) === 34;

      if (fieldQuoted) {
        const open = pos;
        const openLine = line;
        const start = ++pos; // skip the opening quote
        let segStart = start;
        let built = '';
        let closed = false;
        while (pos < n) {
          const c = text.charCodeAt(pos);
          if (c === 34) {
            if (pos + 1 < n && text.charCodeAt(pos + 1) === 34) {
              built += text.slice(segStart, pos) + '"'; // "" -> "
              pos += 2;
              segStart = pos;
              continue;
            }
            closed = true; // a quote not followed by another quote closes the field
            pos += 1;
            break;
          }
          if (c === 13 || c === 10) {
            // Each CR, CRLF or LF inside quotes reads as one LF and counts as a line.
            built += text.slice(segStart, pos) + '\n';
            line += 1;
            pos += c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10 ? 2 : 1;
            segStart = pos;
            continue;
          }
          pos += 1;
        }
        if (closed) {
          const qvalue = built + text.slice(segStart, pos - 1);
          if (pos >= n) {
            value = qvalue;
            ended = END;
            needUnquoted = false;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              value = qvalue;
              ended = COMMA;
              needUnquoted = false;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              value = qvalue;
              ended = LINE_BREAK;
              needUnquoted = false;
            } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              value = qvalue;
              ended = LINE_BREAK;
              needUnquoted = false;
            } else {
              // What follows the closing quote is appended as-is, up to a comma or
              // line break. `added` decides whether it is a quote_junk error.
              initial = qvalue;
              junkCase = true;
            }
          }
        } else {
          // The quote never closed: it is a literal, and the text after it is reread
          // as unquoted with `line` reset to the line the opening quote was on.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          initial = '"';
        }
      }

      if (needUnquoted) {
        // Unquoted characters onto `initial`, up to a comma, line break or end. Lone
        // CRs are dropped with a stray_cr error and need a parts array (rare); the
        // common field needs only one slice.
        const start = pos;
        let segStart = start;
        let contentEnd = start;
        let parts = null;
        ended = END;
        while (pos < n) {
          const c = text.charCodeAt(pos);
          if (c === 44) {
            contentEnd = pos;
            pos += 1;
            ended = COMMA;
            break;
          }
          if (c === 10) {
            contentEnd = pos;
            pos += 1;
            line += 1;
            ended = LINE_BREAK;
            break;
          }
          if (c === 13) {
            if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
              contentEnd = pos;
              pos += 2;
              line += 1;
              ended = LINE_BREAK;
              break;
            }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, pos));
            pos += 1;
            segStart = pos;
            contentEnd = pos;
            continue;
          }
          pos += 1;
        }
        if (ended === END) contentEnd = n; // no delimiter was consumed
        if (parts === null) {
          const slice = text.slice(start, contentEnd);
          value = initial === '' ? slice : initial + slice;
        } else {
          parts.push(text.slice(segStart, contentEnd));
          const joined = parts.join('');
          value = initial === '' ? joined : initial + joined;
        }
      }

      fields[nf++] = value;
      if (junkCase && value.length > initial.length) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      lastQuoted = fieldQuoted;
      if (ended !== COMMA) break;
    }

    // A line left with no characters by stray CRs is no record; its errors stay.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
