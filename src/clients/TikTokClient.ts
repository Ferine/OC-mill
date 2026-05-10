import { openAsBlob } from 'fs';
import { stat } from 'fs/promises';
import { logger } from '../utils/logger';

/**
 * TikTok Content Posting API client.
 *
 * Endpoints:
 *   POST  /v2/post/publish/video/init/      — initialize upload
 *   PUT   <upload_url>                       — upload the video bytes
 *   POST  /v2/post/publish/video/complete/  — publish
 *
 * Reference: https://developers.tiktok.com/doc/content-posting-api-get-started
 * Auth: OAuth 2.0 access token with `video.upload` scope.
 */

export interface TikTokUploadRequest {
  filePath: string;
  caption: string;
  visibility?: 'public' | 'friends' | 'private';
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
}

export interface TikTokUploadResponse {
  postId: string;
  status: 'processing' | 'published' | 'failed';
  shareUrl?: string;
  embedUrl?: string;
  message?: string;
}

export interface TikTokInitUploadResponse {
  uploadId: string;
  uploadUrl: string;
}

export interface TikTokClientConfig {
  apiKey: string;
  baseUrl: string;
  userId?: string;
}

export class TikTokClient {
  private apiKey: string;
  private baseUrl: string;
  private userId?: string;

  constructor(config: TikTokClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.userId = config.userId;

    logger.info('TikTokClient initialized', {
      baseUrl: this.baseUrl,
      hasUserId: !!this.userId,
    });
  }

  public async uploadVideo(
    request: TikTokUploadRequest
  ): Promise<TikTokUploadResponse> {
    logger.info('Starting TikTok video upload', {
      filePath: request.filePath,
      captionLength: request.caption.length,
      visibility: request.visibility || 'public',
    });

    const stats = await stat(request.filePath);
    logger.info('Video file validated', {
      sizeBytes: stats.size,
      sizeMB: (stats.size / 1024 / 1024).toFixed(2),
    });

    const init = await this.initializeUpload(stats.size);
    await this.uploadVideoFile(request.filePath, init.uploadUrl);
    const result = await this.publishVideo(init.uploadId, request);

    logger.info('TikTok video uploaded successfully', {
      postId: result.postId,
      status: result.status,
      shareUrl: result.shareUrl,
    });
    return result;
  }

  private async initializeUpload(
    videoSize: number
  ): Promise<TikTokInitUploadResponse> {
    const response = await fetch(
      `${this.baseUrl}/v2/post/publish/video/init/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          source_info: { source: 'FILE_UPLOAD', video_size: videoSize },
        }),
      }
    );
    if (!response.ok) {
      throw new Error(
        `TikTok init upload failed: ${response.status} ${await response.text()}`
      );
    }
    const data = (await response.json()) as {
      data?: { upload_id?: string; upload_url?: string };
      upload_id?: string;
      upload_url?: string;
    };
    const uploadId = data.data?.upload_id ?? data.upload_id;
    const uploadUrl = data.data?.upload_url ?? data.upload_url;
    if (!uploadId || !uploadUrl) {
      throw new Error(`TikTok init missing upload_id/upload_url: ${JSON.stringify(data)}`);
    }
    logger.info('Upload initialized', { uploadId });
    return { uploadId, uploadUrl };
  }

  private async uploadVideoFile(
    filePath: string,
    uploadUrl: string
  ): Promise<void> {
    const blob = await openAsBlob(filePath);
    const form = new FormData();
    form.append('video', blob, 'video.mp4');

    const response = await fetch(uploadUrl, { method: 'PUT', body: form });
    if (!response.ok) {
      throw new Error(
        `TikTok file upload failed: ${response.status} ${await response.text()}`
      );
    }
    logger.info('Video file uploaded successfully');
  }

  private async publishVideo(
    uploadId: string,
    request: TikTokUploadRequest
  ): Promise<TikTokUploadResponse> {
    const payload = {
      upload_id: uploadId,
      post_info: {
        title: request.caption,
        privacy_level: this.mapVisibilityToPrivacyLevel(
          request.visibility ?? 'public'
        ),
        disable_comment: request.disableComment ?? false,
        disable_duet: request.disableDuet ?? false,
        disable_stitch: request.disableStitch ?? false,
      },
    };

    const response = await fetch(
      `${this.baseUrl}/v2/post/publish/video/complete/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      throw new Error(
        `TikTok publish failed: ${response.status} ${await response.text()}`
      );
    }
    const data = (await response.json()) as {
      data?: Record<string, unknown>;
      message?: string;
    } & Record<string, unknown>;
    const info = (data.data ?? data) as Record<string, unknown>;
    return {
      postId: String(info.publish_id ?? info.post_id ?? ''),
      status: (info.status as TikTokUploadResponse['status']) ?? 'processing',
      shareUrl: info.share_url as string | undefined,
      embedUrl: info.embed_url as string | undefined,
      message: data.message,
    };
  }

  public async getPostStatus(postId: string): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/v2/post/list/?post_id=${postId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      }
    );
    if (!response.ok) {
      throw new Error(
        `Failed to fetch post status: ${response.status} ${await response.text()}`
      );
    }
    return response.json();
  }

  private mapVisibilityToPrivacyLevel(
    visibility: 'public' | 'friends' | 'private'
  ): string {
    return {
      public: 'PUBLIC_TO_EVERYONE',
      friends: 'MUTUAL_FOLLOW_FRIENDS',
      private: 'SELF_ONLY',
    }[visibility];
  }
}
