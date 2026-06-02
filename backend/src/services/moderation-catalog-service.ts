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
      'Scam, phishing, fake giveaway, credential theft, or wallet seed theft.'
  },
  {
    catalogId: 'THREAT',
    label: 'Threat',
    definition:
      'Credible violence, incitement to violence, or targeted intimidation.'
  },
  {
    catalogId: 'MINOR_EXPLOITATION',
    label: 'Minor exploitation',
    definition: 'Sexual content involving minors or child exploitation.'
  },
  {
    catalogId: 'MALWARE',
    label: 'Malware',
    definition:
      'Malware, dangerous links, malicious downloads, or executable attack files.'
  },
  {
    catalogId: 'DOXXING',
    label: 'Doxxing',
    definition:
      'Revealing private personal information such as home address, phone number, or identity documents.'
  },
  {
    catalogId: 'SEVERE_HATE',
    label: 'Severe hate',
    definition:
      'Severe hate speech, slurs, or targeted bigotry beyond ordinary insults.'
  },
  {
    catalogId: 'SELF_PROMO',
    label: 'Self-promotion',
    definition: 'Self-promotion, advertising, follow begging, or channel ads.'
  },
  {
    catalogId: 'INSULT',
    label: 'Insult',
    definition: 'Direct insults, name-calling, or abusive personal remarks.'
  },
  {
    catalogId: 'TROLLING',
    label: 'Trolling',
    definition: 'Trolling, baiting, or provoking chat arguments.'
  },
  {
    catalogId: 'SYMBOL_FLOOD',
    label: 'Symbol flood',
    definition:
      'Excessive caps, emoji spam, symbol spam, or walls of characters.'
  },
  {
    catalogId: 'SEXUAL_LANGUAGE',
    label: 'Sexual language',
    definition: 'Adult sexual language, graphic language, or sexual insults.'
  },
  {
    catalogId: 'HARASSMENT',
    label: 'Harassment',
    definition:
      'Sustained personal attacks, stalking, or targeted harassment campaigns.'
  },
  {
    catalogId: 'SPAM',
    label: 'Spam',
    definition: 'Repetitive bot-like messages, link spam, or copy-pasted flooding.'
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
