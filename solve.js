// csv-reader-speed-01: a dependency-free port of make.fun's csv-reader 1.0.0's readCsv.
//
// Same single left-to-right pass and broken-row policy as the reference (BOM drop,
// empty-line skipping, stray CRs, quoted escapes/junk/unterminated quotes, width
// padding/cutting, and error order), but fields are located by charCodeAt and cut
// out with slice() instead of being concatenated one character at a time. Quoted
// fields only allocate a parts array when they really contain an escape, CRLF or
// line break; ordinary fields cost one slice each and no string addition. Escape
// pieces and field arrays are filled by indexed stores rather than push() calls,
// which keeps the V8 hot loops free of builtin-call overhead.

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
  // The last field read (shared by the two scanners to avoid an object per field).
  let fieldValue = '';
  let fieldEnded = END;
  let fieldAdded = 0;

  // Unquoted characters onto `initial`, up to a comma, line break, or end. Lone CRs
  // are dropped with a stray_cr error; `added` counts only the newly kept characters.
  function readUnquoted(initial) {
    const start = pos;
    let segStart = start;
    let contentEnd = start;
    let parts = null; // allocated lazily: ordinary fields need just one slice
    let ended = END;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) { // ,
        contentEnd = pos;
        pos += 1;
        ended = COMMA;
        break;
      }
      if (c === 10) { // LF
        contentEnd = pos;
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        break;
      }
      if (c === 13) { // CR: CRLF ends the field, a lone CR is dropped
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
    if (ended === END) contentEnd = n; // loop ran off the end; no delimiter was consumed
    let value;
    let added;
    if (parts === null) {
      value = initial === '' ? text.slice(start, contentEnd) : initial + text.slice(start, contentEnd);
      added = contentEnd - start;
    } else {
      parts.push(text.slice(segStart, contentEnd));
      value = initial + parts.join('');
      added = value.length - initial.length;
    }
    fieldValue = value;
    fieldEnded = ended;
    fieldAdded = added;
  }

  // A quoted field whose opening quote is at pos. "" -> ", CR/CRLF/LF -> LF (line++).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    const start = ++pos; // skip the opening quote
    let segStart = start;
    let contentEnd = start;
    let parts = null;
    let np = 0; // number of pieces accumulated for parts
    let closed = false;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 34) { // "
        if (pos + 1 < n && text.charCodeAt(pos + 1) === 34) {
          if (parts === null) parts = [];
          parts[np++] = text.slice(segStart, pos);
          parts[np++] = '"';
          pos += 2;
          segStart = pos;
          continue;
        }
        contentEnd = pos;
        pos += 1;
        closed = true;
        break;
      }
      if (c === 13 || c === 10) { // each CR, CRLF or LF inside quotes reads as one LF
        if (parts === null) parts = [];
        parts[np++] = text.slice(segStart, pos);
        parts[np++] = '\n';
        line += 1;
        pos += c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        segStart = pos;
        continue;
      }
      pos += 1;
    }
    if (!closed) {
      // The opening quote was a literal; reread everything after it as unquoted,
      // and undo the line increments made while scanning for a closing quote.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }

    let value;
    if (parts === null) {
      value = text.slice(start, contentEnd);
    } else {
      parts[np++] = text.slice(segStart, contentEnd);
      value = parts.join('');
    }
    if (pos >= n) {
      fieldValue = value;
      fieldEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fieldValue = value;
      fieldEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fieldValue = value;
      fieldEnded = LINE_BREAK;
      return;
    }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fieldValue = value;
      fieldEnded = LINE_BREAK;
      return;
    }
    // Anything after the closing quote is appended as-is, up to a comma or line break.
    readUnquoted(value);
    if (fieldAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

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
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields[nf++] = fieldValue;
    } while (fieldEnded === COMMA);

    // A line left with no characters by stray CRs is no record; its errors stay.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

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
