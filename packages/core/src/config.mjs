const KEYS = ['test', 'comments', 'conclusion', 'ignore', 'enabled'];

function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

export function readConfig(text) {
  const config = { test: null, comments: 'off', conclusion: 'neutral', ignore: [], enabled: true };
  const reasons = [];
  for (const raw of String(text ?? '').split('\n')) {
    if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) continue;
    if (/^\s/.test(raw)) {
      reasons.push('refused nested line');
      continue;
    }
    const m = /^([A-Za-z][\w.-]*)\s*:\s*(.*)$/.exec(raw);
    if (!m) {
      reasons.push('refused line');
      continue;
    }
    const key = m[1];
    let value = m[2].trim();
    if (/^(?:\|[-+]?|>[-+]?)$/.test(value) || /&\w/.test(raw) || /^\*(?!\*)\w/.test(value)) {
      reasons.push(`refused ${key}`);
      continue;
    }
    value = unquote(value);
    if (!KEYS.includes(key)) {
      reasons.push(`unknown key ${key}`);
      continue;
    }
    if (key === 'test') {
      config.test = value;
      continue;
    }
    if (key === 'comments') {
      if (value === 'off' || value === 'on') config.comments = value;
      else reasons.push(`refused comments: ${value}`);
      continue;
    }
    if (key === 'conclusion') {
      if (value === 'neutral' || value === 'fail-on-tampered') config.conclusion = value;
      else reasons.push(`refused conclusion: ${value}`);
      continue;
    }
    if (key === 'enabled') {
      if (value === 'true') config.enabled = true;
      else if (value === 'false') config.enabled = false;
      else reasons.push(`refused enabled: ${value}`);
      continue;
    }
    config.ignore = value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return { config, reasons };
}
