export interface ImageAttachment {
  id: string
  path: string
  preview: string
  width: number
  height: number
}

export interface InputDraft {
  text: string
  images: readonly ImageAttachment[]
}
