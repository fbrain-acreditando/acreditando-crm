'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Paperclip, Smile, Clock, FileText, X, Loader2, Image, File as FileIcon, Mic, Square, Reply } from 'lucide-react';
import dynamic from 'next/dynamic';
import { type EmojiClickData, Theme } from 'emoji-picker-react';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => <div className="w-[320px] h-[400px] animate-pulse bg-slate-800 rounded-xl" />,
});
import { cn } from '@/lib/utils';
import { useSendTextMessage, useSendMessage } from '@/lib/query/hooks/useMessagingMessagesQuery';
import { useAssignConversation } from '@/lib/query/hooks/useConversationsQuery';
import { useAuth } from '@/context/AuthContext';
import { useMediaUploadMutation } from '@/lib/query/hooks/useMediaUploadMutation';
import {
  useApprovedTemplatesQuery,
  useSendTemplateMutation,
} from '@/lib/query/hooks/useTemplatesQuery';
import { TemplateSelector, type TemplateData } from './TemplateSelector';
import type { ConversationView, MessageContent, MessagingMessage } from '@/lib/messaging/types';
import { useGravadorDeAudio, formatarDuracao } from '../hooks/useGravadorDeAudio';

interface MessageInputProps {
  conversation: ConversationView;
  replyTo?: MessagingMessage | null;
  onCancelReply?: () => void;
}

interface PendingMedia {
  file: File;
  preview: string | null;
  mediaType: 'image' | 'video' | 'audio' | 'document';
}

const ACCEPTED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/3gpp',
  'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
].join(',');

function getMediaType(mimeType: string): PendingMedia['mediaType'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function MessageInput({ conversation, replyTo, onCancelReply }: MessageInputProps) {
  const [text, setText] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const { profile } = useAuth();
  const { mutate: sendTextMessage } = useSendTextMessage();
  const sendMessage = useSendMessage();
  const uploadMedia = useMediaUploadMutation();
  const { mutate: sendTemplate, isPending: isSendingTemplate } = useSendTemplateMutation();
  const { mutate: assignConversation } = useAssignConversation();

  // Claim (or sequester) conversation on send: assign to current user regardless of
  // current assignee. If already mine, this is a no-op on the DB.
  const claimConversation = useCallback(() => {
    if (!profile?.id) return;
    if (conversation.assignedUserId === profile.id) return;
    assignConversation({ conversationId: conversation.id, userId: profile.id });
  }, [profile?.id, conversation.assignedUserId, conversation.id, assignConversation]);
  const { data: templates = [], isLoading: isLoadingTemplates } = useApprovedTemplatesQuery(
    conversation.channelId
  );

  const isUploading = uploadMedia.isPending;
  // Text sends use optimistic updates — no need to block the input while the API is in flight.
  // Only block during: media upload (can't parallelize), template send, expired window.
  const isDisabled = conversation.isWindowExpired || isSendingTemplate || isUploading;
  // Show mic button when input is empty, no pending media, and not recording
  const showMicButton = !text.trim() && !pendingMedia && !isDisabled;

  // Cleanup blob URL on unmount to prevent memory leaks (FIX-03)
  // Also used by clearMedia to avoid depending on the entire pendingMedia object.
  const pendingMediaRef = useRef(pendingMedia);
  useEffect(() => { pendingMediaRef.current = pendingMedia; }, [pendingMedia]);
  useEffect(() => {
    return () => {
      if (pendingMediaRef.current?.preview) {
        URL.revokeObjectURL(pendingMediaRef.current.preview);
      }
    };
  }, []);

  // Close emoji picker when clicking outside
  useEffect(() => {
    if (!showEmojiPicker) return;
    function handleClickOutside(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker]);

  const handleEmojiClick = useCallback((emojiData: EmojiClickData) => {
    const emoji = emojiData.emoji;
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart ?? text.length;
      const end = textarea.selectionEnd ?? text.length;
      const newText = text.slice(0, start) + emoji + text.slice(end);
      setText(newText);
      requestAnimationFrame(() => {
        textarea.selectionStart = start + emoji.length;
        textarea.selectionEnd = start + emoji.length;
        textarea.focus();
      });
    } else {
      setText(prev => prev + emoji);
    }
    setShowEmojiPicker(false);
  }, [text]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const mediaType = getMediaType(file.type);
    const preview = mediaType === 'image' ? URL.createObjectURL(file) : null;

    setPendingMedia({ file, preview, mediaType });

    // Reset input so same file can be selected again
    e.target.value = '';
  }, []);

  // Stable callback — reads latest pendingMedia via ref, no dep on the state value.
  const clearMedia = useCallback(() => {
    if (pendingMediaRef.current?.preview) {
      URL.revokeObjectURL(pendingMediaRef.current.preview);
    }
    setPendingMedia(null);
  }, []);

  // Gravação extraída para `useGravadorDeAudio` (story 2.52) — mesmo comportamento.
  const {
    isRecording,
    isConverting,
    recordingDuration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useGravadorDeAudio({
    onAudioPronto: (file) => setPendingMedia({ file, preview: null, mediaType: 'audio' }),
    onFalhaNaConversao: () => setPendingMedia(null),
  });

  const formatDuration = formatarDuracao;

  const handleSendMedia = useCallback(async () => {
    if (!pendingMedia || isDisabled) return;

    uploadMedia.mutate(
      { file: pendingMedia.file, conversationId: conversation.id },
      {
        onSuccess: (result) => {
          const content: MessageContent = {
            type: result.mediaType,
            mediaUrl: result.mediaUrl,
            mimeType: result.mimeType,
            fileName: result.fileName,
            fileSize: result.fileSize,
            ...(text.trim() ? { caption: text.trim() } : {}),
          } as MessageContent;

          sendMessage.mutate(
            { conversationId: conversation.id, content, replyToMessageId: replyTo?.id },
            {
              onSuccess: () => {
                setText('');
                clearMedia();
                onCancelReply?.();
                textareaRef.current?.focus();
              },
            }
          );
        },
      }
    );
  }, [pendingMedia, isDisabled, uploadMedia, conversation.id, text, sendMessage]);

  const handleTemplateSelect = useCallback(
    (template: TemplateData, params?: Record<string, string>) => {
      const bodyParams = params
        ? Object.entries(params)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .map(([, value]) => ({ type: 'text' as const, text: value }))
        : [];

      claimConversation();
      sendTemplate(
        {
          conversationId: conversation.id,
          templateId: template.id,
          parameters: bodyParams.length > 0 ? { body: bodyParams } : undefined,
        },
        {
          onSuccess: () => {
            setShowTemplates(false);
          },
        }
      );
    },
    [sendTemplate, conversation.id, claimConversation]
  );

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();

    // If media is pending, send media message instead
    if (pendingMedia) {
      claimConversation();
      handleSendMedia();
      return;
    }

    const trimmedText = text.trim();
    if (!trimmedText || isDisabled) return;

    // Clear immediately — optimistic message already in cache via onMutate
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    textareaRef.current?.focus();

    claimConversation();
    sendTextMessage({ conversationId: conversation.id, text: trimmedText, replyToMessageId: replyTo?.id });
    onCancelReply?.();
  }, [text, isDisabled, sendTextMessage, conversation.id, pendingMedia, handleSendMedia, replyTo, onCancelReply, claimConversation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target;
    setText(textarea.value);
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = newHeight + 'px';
  }, []);

  // Converting state — shown while webm → mp3 encoding runs
  if (isConverting) {
    return (
      <div className="border-t border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-3 px-4 py-3">
          <Loader2 className="w-4 h-4 animate-spin text-primary-500 flex-shrink-0" />
          <span className="text-sm text-slate-500 dark:text-slate-400">Processando áudio...</span>
        </div>
      </div>
    );
  }

  // Recording state — shown instead of the normal input
  if (isRecording) {
    return (
      <div className="border-t border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Pulsing red dot */}
          <span className="relative flex h-3 w-3 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          <span className="text-sm font-medium text-red-500 tabular-nums w-12">
            {formatDuration(recordingDuration)}
          </span>
          <span className="flex-1 text-sm text-slate-500 dark:text-slate-400">Gravando áudio...</span>
          {/* Cancel */}
          <button
            type="button"
            onClick={cancelRecording}
            className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
            title="Cancelar gravação"
            aria-label="Cancelar gravação"
          >
            <X className="w-5 h-5" />
          </button>
          {/* Stop and send */}
          <button
            type="button"
            onClick={stopRecording}
            className="p-2.5 rounded-full bg-primary-500 hover:bg-primary-600 text-white shadow-sm transition-colors"
            title="Parar e enviar"
            aria-label="Parar e enviar"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
        </div>
      </div>
    );
  }

  // Show template selector when window expired or when manually opened
  if (showTemplates || conversation.isWindowExpired) {
    return (
      <div className="border-t border-slate-200 dark:border-white/10">
        {conversation.isWindowExpired && !showTemplates && (
          <div className="p-4 bg-orange-50 dark:bg-orange-900/20">
            <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
              <Clock className="w-5 h-5" />
              <div>
                <p className="font-medium">Janela de resposta expirada</p>
                <p className="text-sm opacity-80">
                  Use um template aprovado para reabrir a conversa
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowTemplates(true)}
              className="mt-3 px-4 py-2 text-sm font-medium bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
            >
              Enviar template
            </button>
          </div>
        )}
        {showTemplates && (
          <div className="h-[400px] bg-white dark:bg-slate-900">
            <TemplateSelector
              templates={templates}
              isLoading={isLoadingTemplates || isSendingTemplate}
              onSelect={handleTemplateSelect}
              onCancel={() => setShowTemplates(false)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900"
    >
      {/* Reply preview bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5">
          <Reply className="w-4 h-4 text-primary-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-primary-500">
              {replyTo.direction === 'outbound' ? 'Você' : (replyTo.senderName ?? 'Contato')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {replyTo.contentType === 'text'
                ? (replyTo.content as { text: string }).text
                : replyTo.contentType === 'audio' ? '🎤 Áudio'
                : replyTo.contentType === 'image' ? '📷 Foto'
                : replyTo.contentType === 'document' ? '📄 Documento'
                : 'Mensagem'}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
            aria-label="Cancelar resposta"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Media preview */}
      {pendingMedia && (
        <div className="px-4 pt-3">
          <div className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-white/5 rounded-lg border border-slate-200 dark:border-white/10">
            {pendingMedia.preview ? (
              <img
                src={pendingMedia.preview}
                alt="Preview"
                className="w-16 h-16 rounded-lg object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-slate-100 dark:bg-white/10 flex items-center justify-center">
                {pendingMedia.mediaType === 'document' ? (
                  <FileIcon className="w-6 h-6 text-slate-400" />
                ) : pendingMedia.mediaType === 'audio' ? (
                  <div className="flex flex-col items-center gap-0.5">
                    <Mic className="w-5 h-5 text-primary-500" />
                    <span className="text-[9px] font-medium text-primary-500 uppercase">mp3</span>
                  </div>
                ) : (
                  <Image className="w-6 h-6 text-slate-400" />
                )}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                {pendingMedia.file.name}
              </p>
              <p className="text-xs text-slate-400">
                {formatFileSize(pendingMedia.file.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={clearMedia}
              className="p-1 text-slate-400 hover:text-red-500 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 p-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Input pill: attach + textarea + emoji + template */}
        <div className={cn(
          'flex-1 flex items-end rounded-2xl transition-colors',
          'bg-slate-100 dark:bg-white/5',
          'ring-1 ring-transparent focus-within:ring-primary-500/50 focus-within:bg-white dark:focus-within:bg-white/[0.07]'
        )}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex-shrink-0 p-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors disabled:opacity-50"
            title="Anexar arquivo"
            aria-label="Anexar arquivo"
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Paperclip className="w-5 h-5" />
            )}
          </button>

          <label htmlFor="message-input" className="sr-only">
            {pendingMedia ? 'Adicionar legenda (opcional)' : 'Digite uma mensagem'}
          </label>
          <textarea
            ref={textareaRef}
            id="message-input"
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={pendingMedia ? 'Adicionar legenda (opcional)...' : 'Digite uma mensagem...'}
            disabled={isDisabled}
            rows={1}
            aria-label={pendingMedia ? 'Adicionar legenda (opcional)' : 'Digite uma mensagem'}
            className={cn(
              'flex-1 py-2.5 text-sm resize-none bg-transparent',
              'focus:outline-none',
              'text-slate-900 dark:text-white placeholder-slate-400',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'max-h-[120px]'
            )}
            style={{ height: 'auto', minHeight: '40px' }}
          />

          <div className="relative flex items-end flex-shrink-0 pb-0.5 pr-1" ref={emojiPickerRef}>
            {showEmojiPicker && (
              <div className="absolute bottom-full right-0 mb-2 z-50">
                <EmojiPicker
                  onEmojiClick={handleEmojiClick}
                  theme={Theme.AUTO}
                  width={320}
                  height={400}
                  searchPlaceholder="Buscar emoji..."
                  lazyLoadEmojis
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowEmojiPicker(prev => !prev)}
              className={cn(
                'p-2 rounded-xl transition-colors',
                showEmojiPicker
                  ? 'text-primary-500'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              )}
              title="Emojis"
              aria-label="Emojis"
            >
              <Smile className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setShowTemplates(true)}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-xl transition-colors"
              title="Enviar template"
              aria-label="Enviar template"
            >
              <FileText className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Send or mic button */}
        {showMicButton ? (
          <button
            type="button"
            onClick={startRecording}
            className="flex-shrink-0 p-2.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-primary-500 hover:text-white transition-colors"
            title="Gravar áudio"
            aria-label="Gravar áudio"
          >
            <Mic className="w-5 h-5" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={(!text.trim() && !pendingMedia) || isDisabled}
            aria-label="Enviar mensagem"
            className={cn(
              'flex-shrink-0 p-2.5 rounded-full transition-colors',
              (text.trim() || pendingMedia) && !isDisabled
                ? 'bg-primary-500 hover:bg-primary-600 text-white shadow-sm'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
            )}
          >
            <Send className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}
