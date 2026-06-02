import { ModerationCatalog } from '../models/moderation-catalog.js'

export interface ModerationCatalogSeedEntry {
  catalogId: string
  label: string
  definition: string
}

export const CANONICAL_MODERATION_CATALOG: readonly ModerationCatalogSeedEntry[] = [
  {
    catalogId: 'SCAM',
    label: 'Scam or phishing',
    definition:
      'Attempts to trick people into sending money or crypto, sharing credentials or wallet keys, or trusting fake giveaways, verification flows, recovery help, or guaranteed-return offers such as "send 1 BTC and get 2 BTC back."'
  },
  {
    catalogId: 'THREAT',
    label: 'Threat',
    definition:
      'Threats of violence, wishes of harm, incitement, or targeted intimidation that imply real-world danger or retaliation.'
  },
  {
    catalogId: 'MINOR_EXPLOITATION',
    label: 'Minor exploitation',
    definition:
      'Any sexual content involving minors, grooming, or child exploitation material or requests.'
  },
  {
    catalogId: 'MALWARE',
    label: 'Malware',
    definition:
      'Attempts to distribute or recommend malicious files, stealers, keyloggers, phishing kits, suspicious executables, or harmful download links.'
  },
  {
    catalogId: 'DOXXING',
    label: 'Doxxing',
    definition:
      'Sharing or soliciting private identifying information such as addresses, phone numbers, personal email, legal identity, documents, workplace, school, or family details.'
  },
  {
    catalogId: 'SEVERE_HATE',
    label: 'Severe hate',
    definition:
      'Slurs, dehumanization, or explicit hostility toward protected groups based on identity such as race, ethnicity, religion, nationality, gender, sexuality, or disability.'
  },
  {
    catalogId: 'SELF_PROMO',
    label: 'Self-promotion',
    definition:
      'Promoting your own channel, social account, server, store, referral code, or asking viewers to follow, sub, DM, or go elsewhere for non-deceptive promotion.'
  },
  {
    catalogId: 'INSULT',
    label: 'Insult',
    definition:
      'One-off personal abuse or name-calling aimed at a person, such as "idiot" or "shut up," without identity-based hate or sustained targeting.'
  },
  {
    catalogId: 'TROLLING',
    label: 'Trolling',
    definition:
      'Bad-faith baiting or provocation meant to derail chat, farm reactions, or start arguments without a direct threat or clear personal insult.'
  },
  {
    catalogId: 'SYMBOL_FLOOD',
    label: 'Symbol flood',
    definition:
      'Messages dominated by repeated caps, emoji, punctuation, symbols, or unreadable character walls rather than meaningful text.'
  },
  {
    catalogId: 'SEXUAL_LANGUAGE',
    label: 'Sexual language',
    definition:
      'Explicit sexual language, propositions, graphic descriptions, or sexual insults involving adults. Use minor exploitation instead if minors are involved.'
  },
  {
    catalogId: 'HARASSMENT',
    label: 'Harassment',
    definition:
      'Repeated or targeted abuse, stalking, dogpiling, or persistent unwanted targeting of a person across messages or over time.'
  },
  {
    catalogId: 'SPAM',
    label: 'Spam',
    definition:
      'Repetitive, copy-pasted, automated, or high-frequency posting, including repeated links or the same message across chat. Use self-promotion when the main issue is advertising.'
  }
] as const

export function normalizeCatalogId(value: string): string {
  return value.trim().toUpperCase()
}

export async function seedModerationCatalog(): Promise<void> {
  await Promise.all(
    CANONICAL_MODERATION_CATALOG.map(async (entry) => {
      await ModerationCatalog.findOneAndUpdate(
        { catalogId: entry.catalogId },
        {
          $set: {
            label: entry.label,
            definition: entry.definition
          },
          $setOnInsert: {
            catalogId: entry.catalogId
          }
        },
        {
          new: true,
          upsert: true
        }
      ).exec()
    })
  )
}

export function listModerationCatalogEntries(): ModerationCatalogSeedEntry[] {
  return CANONICAL_MODERATION_CATALOG.map((entry) => ({ ...entry }))
}

export async function hasModerationCatalogEntry(catalogId: string): Promise<boolean> {
  const existing = await ModerationCatalog.findOne({
    catalogId: normalizeCatalogId(catalogId)
  }).exec()

  return existing !== null
}
