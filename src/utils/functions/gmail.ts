interface FunctionResult {
  success: boolean
  data?: any
  error?: string
}

interface EmailMessageArgs {
  to: string
  subject: string
  body: string
  cc?: string
  bcc?: string
}

function requireIpc() {
  if (typeof window === 'undefined' || !window.aliceIPC?.invoke) {
    throw new Error('Electron IPC 桥接不可用。')
  }
  return window.aliceIPC
}

export async function create_email_draft(
  args: EmailMessageArgs
): Promise<FunctionResult> {
  if (!args.to?.trim() || !args.subject?.trim() || !args.body?.trim()) {
    return { success: false, error: '收件人、主题和正文不能为空。' }
  }
  try {
    const result = await requireIpc().invoke('google-gmail:create-draft', {
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      body: args.body,
    })
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function reply_to_email(args: {
  messageId: string
  body: string
}): Promise<FunctionResult> {
  if (!args.messageId?.trim() || !args.body?.trim()) {
    return { success: false, error: '邮件 ID 和回复正文不能为空。' }
  }
  try {
    const result = await requireIpc().invoke('google-gmail:reply-message', {
      messageId: args.messageId,
      body: args.body,
    })
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function send_email(
  args: EmailMessageArgs
): Promise<FunctionResult> {
  if (!args.to?.trim() || !args.subject?.trim() || !args.body?.trim()) {
    return { success: false, error: '收件人、主题和正文不能为空。' }
  }
  try {
    const result = await requireIpc().invoke('google-gmail:send-message', {
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      body: args.body,
    })
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
