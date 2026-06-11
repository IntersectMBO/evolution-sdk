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