// ...

// Update voterToKey to give distinct prefixes and sort type-first then hash
export const voterToKey = (voter: Certificate.Voter): string => {
  const prefix = voter.type === 'DRepr' ? 'drep-' : 'cc-';
  const type = voter.credential.type === 'ScriptHash' ? 'script' : 'key';
  return `${prefix}${type}-${Bytes.toHex(voter.credential.hash)}`;
};

// ...