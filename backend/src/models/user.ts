import { Schema, model, type Document } from 'mongoose'

export interface IStoredSecret {
  iv: string
  tag: string
  ciphertext: string
}

export interface IYoutubeOwnedChannel {
  channelId: string
  name: string
  handle: string | null
  thumbnail: string | null
  qnaEnabled?: boolean
  moderationEnabled?: boolean
}

export interface IUser {
  googleSubject: string
  email: string
  name: string
  picture: string | null
  accessToken?: IStoredSecret
  refreshToken?: IStoredSecret
  accessTokenExpiresAt?: Date | null
  scope: string[]
  channels: IYoutubeOwnedChannel[]
  activeChannelId: string
  lastLoginAt: Date
  createdAt: Date
  updatedAt: Date
}

export type IUserDocument = Document<unknown, object, IUser> & IUser

const storedSecretSchema = new Schema<IStoredSecret>(
  {
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    ciphertext: { type: String, required: true }
  },
  { _id: false }
)

const ownedChannelSchema = new Schema<IYoutubeOwnedChannel>(
  {
    channelId: { type: String, required: true },
    name: { type: String, required: true },
    handle: { type: String, default: null },
    thumbnail: { type: String, default: null },
    qnaEnabled: { type: Boolean, default: true },
    moderationEnabled: { type: Boolean, default: true }
  },
  { _id: false }
)

const userSchema = new Schema<IUser>(
  {
    googleSubject: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
    picture: { type: String, default: null },
    accessToken: { type: storedSecretSchema, required: false },
    refreshToken: { type: storedSecretSchema, required: false },
    accessTokenExpiresAt: { type: Date, default: null },
    scope: { type: [String], default: [] },
    channels: { type: [ownedChannelSchema], default: [] },
    activeChannelId: { type: String, required: true },
    lastLoginAt: { type: Date, required: true }
  },
  { timestamps: true }
)

userSchema.index({ email: 1 })
userSchema.index({ 'channels.channelId': 1 })

export const User = model<IUser>('User', userSchema)
