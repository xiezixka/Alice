import { google, gmail_v1 } from 'googleapis'

interface ListMessagesParams {
  authClient: any
  userId?: string
  maxResults?: number
  labelIds?: string[]
  q?: string
  includeSpamTrash?: boolean
}

interface GetMessageParams {
  authClient: any
  userId?: string
  id: string
  format?: 'full' | 'metadata' | 'minimal' | 'raw'
}

export interface ComposeMessageParams {
  authClient: any
  userId?: string
  to: string
  cc?: string
  bcc?: string
  subject: string
  body: string
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function normalizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, ' ').trim()
}

function buildRawMessage(params: {
  to: string
  cc?: string
  bcc?: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string
}): string {
  const headers = [
    `To: ${normalizeHeaderValue(params.to)}`,
    params.cc ? `Cc: ${normalizeHeaderValue(params.cc)}` : '',
    params.bcc ? `Bcc: ${normalizeHeaderValue(params.bcc)}` : '',
    `Subject: ${normalizeHeaderValue(params.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    params.inReplyTo
      ? `In-Reply-To: ${normalizeHeaderValue(params.inReplyTo)}`
      : '',
    params.references
      ? `References: ${normalizeHeaderValue(params.references)}`
      : '',
  ].filter(Boolean)
  return encodeBase64Url(`${headers.join('\r\n')}\r\n\r\n${params.body}`)
}

function headerValue(
  message: gmail_v1.Schema$Message,
  name: string
): string | undefined {
  return (
    message.payload?.headers?.find(
      header => header.name?.toLowerCase() === name.toLowerCase()
    )?.value || undefined
  )
}

export async function createDraft({
  authClient,
  userId = 'me',
  to,
  cc,
  bcc,
  subject,
  body,
}: ComposeMessageParams) {
  const gmail = google.gmail({ version: 'v1', auth: authClient })
  try {
    const res = await gmail.users.drafts.create({
      userId,
      requestBody: {
        message: { raw: buildRawMessage({ to, cc, bcc, subject, body }) },
      },
    })
    return {
      success: true,
      data: {
        id: res.data.id,
        messageId: res.data.message?.id,
        threadId: res.data.message?.threadId,
      },
    }
  } catch (error: any) {
    console.error('Error creating Gmail draft:', error.message)
    return { success: false, error: error.message }
  }
}

export async function sendMessage(params: ComposeMessageParams) {
  const gmail = google.gmail({ version: 'v1', auth: params.authClient })
  try {
    const res = await gmail.users.messages.send({
      userId: params.userId || 'me',
      requestBody: { raw: buildRawMessage(params) },
    })
    return {
      success: true,
      data: { id: res.data.id, threadId: res.data.threadId },
    }
  } catch (error: any) {
    console.error('Error sending Gmail message:', error.message)
    return { success: false, error: error.message }
  }
}

export async function replyToMessage({
  authClient,
  userId = 'me',
  messageId,
  body,
}: {
  authClient: any
  userId?: string
  messageId: string
  body: string
}) {
  const gmail = google.gmail({ version: 'v1', auth: authClient })
  try {
    const original = await gmail.users.messages.get({
      userId,
      id: messageId,
      format: 'metadata',
    })
    const message = original.data
    const from =
      headerValue(message, 'Reply-To') || headerValue(message, 'From')
    const subject = headerValue(message, 'Subject') || ''
    const messageIdHeader = headerValue(message, 'Message-ID')
    if (!from)
      return { success: false, error: '原邮件缺少发件人地址，无法回复。' }
    const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`
    const res = await gmail.users.messages.send({
      userId,
      requestBody: {
        threadId: message.threadId || undefined,
        raw: buildRawMessage({
          to: from,
          subject: replySubject,
          body,
          inReplyTo: messageIdHeader,
          references: messageIdHeader,
        }),
      },
    })
    return {
      success: true,
      data: {
        id: res.data.id,
        threadId: res.data.threadId,
        to: from,
        subject: replySubject,
      },
    }
  } catch (error: any) {
    console.error(
      `Error replying to Gmail message ${messageId}:`,
      error.message
    )
    return { success: false, error: error.message }
  }
}

/**
 * Lists messages in the user's mailbox.
 */
export async function listMessages({
  authClient,
  userId = 'me',
  maxResults = 10,
  labelIds,
  q,
  includeSpamTrash = false,
}: ListMessagesParams): Promise<{
  success: boolean
  data?: gmail_v1.Schema$Message[]
  error?: string
}> {
  const gmail = google.gmail({ version: 'v1', auth: authClient })
  try {
    const res = await gmail.users.messages.list({
      userId,
      maxResults,
      labelIds,
      q,
      includeSpamTrash,
    })
    if (!res.data.messages || res.data.messages.length === 0) {
      return { success: true, data: [] }
    }
    return { success: true, data: res.data.messages }
  } catch (error: any) {
    console.error('Error listing Gmail messages:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Gets the specified message.
 */
export async function getMessage({
  authClient,
  userId = 'me',
  id,
  format = 'metadata',
}: GetMessageParams): Promise<{
  success: boolean
  data?: gmail_v1.Schema$Message & { decodedPlainTextBody?: string }
  error?: string
}> {
  const gmail = google.gmail({ version: 'v1', auth: authClient })
  try {
    const res = await gmail.users.messages.get({
      userId,
      id,
      format,
    })

    const messageData = res.data as gmail_v1.Schema$Message & {
      decodedPlainTextBody?: string
    }

    if (format === 'full' && messageData.payload) {
      const plainTextBody = extractPlainTextBody(messageData.payload)
      if (plainTextBody) {
        messageData.decodedPlainTextBody = plainTextBody
      }
    }

    return { success: true, data: messageData }
  } catch (error: any) {
    console.error(`Error getting Gmail message ${id}:`, error.message)
    return { success: false, error: error.message }
  }
}

function decodeBase64UrlToString(base64Url: string): string {
  if (!base64Url) return ''
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  return Buffer.from(base64, 'base64').toString('utf-8')
}

function extractPlainTextBody(
  payload: gmail_v1.Schema$MessagePart | undefined
): string {
  if (!payload) return ''

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64UrlToString(payload.body.data)
  }

  if (payload.parts && payload.parts.length > 0) {
    for (const part of payload.parts) {
      const foundBody = extractPlainTextBody(part)
      if (foundBody) {
        return foundBody
      }
    }
  }
  return ''
}
