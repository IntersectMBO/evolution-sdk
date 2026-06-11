// ...

// Update withdrawal sorting to match Ord Credential
const sortedWithdrawals = withdrawals.sort((a, b) => {
  if (a.credential.type === 'ScriptHash' && b.credential.type === 'KeyHash') {
    return -1;
  } else if (a.credential.type === 'KeyHash' && b.credential.type === 'ScriptHash') {
    return 1;
  } else {
    return Bytes.compare(a.credential.hash, b.credential.hash);
  }
});

// ...

// Update voterToKey to give distinct prefixes and sort type-first then hash
const voterToKey = (voter: Certificate.Voter): string => {
  const prefix = voter.type === 'DRepr' ? 'drep-' : 'cc-';
  const type = voter.credential.type === 'ScriptHash' ? 'script' : 'key';
  return `${prefix}${type}-${Bytes.toHex(voter.credential.hash)}`;
};

// Update voter index assignment to match Ord Voter
const voterIndices: { [key: string]: number } = {};
sortedVoters.forEach((voter, index) => {
  voterIndices[voterToKey(voter)] = index;
});

// ...