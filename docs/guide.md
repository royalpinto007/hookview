# Reading a hook report

A transfer hook is custom code that Token-2022 invokes during a token transfer. It can apply additional rules or update other accounts. A mint's configuration tells us where that code lives, not what it does.

| Result       | Meaning                                                   |
| ------------ | --------------------------------------------------------- |
| Configured   | TransferHook contains a nonzero program address           |
| Disabled     | The extension exists, but its program address is unset    |
| No extension | No TransferHook extension was found in this mint snapshot |
| Legacy token | The mint belongs to the original Token Program            |

The **pointer authority** can update the configured hook program. A missing pointer authority does not prove the program's code is immutable: upgrade authority is separate and not inspected here.

The **extra-account PDA** is optional. Its Execute list can request fixed addresses, PDAs under the hook, PDAs under another program, or addresses read from runtime data. Requested signer/writable flags are configuration, not a grant of the sender's wallet privileges. The token program restricts the core transfer accounts passed to a hook.

Dynamic configurations retain their raw 32-byte config and remain unresolved. Source/destination accounts, transfer amount or other data may be needed. Unknown formats stay unknown. An absent PDA is different from an unreadable or malformed one.

### Limits

- Account reads use confirmed commitment. Secondary reads require a context at least as recent as the mint slot. The reads are separate, not an atomic snapshot.
- Base64 account data, mint padding, option flags, TLV bounds, duplicate extension IDs and extra-account booleans are validated.
- RPC responses are capped at 2 MB with a 10-second timeout per read. Up to 256 extra-account entries are inspected. Limits or secondary failures are reported as unavailable, never zero requirements.
- The local API allows two active lookups and ten starts per minute to reduce accidental public-RPC flooding.
- Other extensions, program source, upgrade controls, account-resolution semantics and actual transfer success are outside this version's analysis.
- Fictional examples use synthetic bytes and addresses and are labelled throughout the UI and exports.

### Official references

- [Transfer hooks overview](https://solana.com/docs/tokens/extensions/transfer-hook)
- [Extra-account configuration](https://www.solana-program.com/docs/transfer-hook-interface/configuring-extra-accounts)
- [Token-2022 TransferHook layout](https://github.com/solana-program/token-2022/blob/main/interface/src/extension/transfer_hook/mod.rs)
- [ExtraAccountMeta layout and discriminators](https://github.com/solana-program/libraries/blob/main/tlv-account-resolution/src/account.rs)

Reviewed 27 October 2026. New formats may require an updated decoder.
