import fetch from 'node-fetch';
import FormData from 'form-data';
import { createReadStream, statSync } from 'fs';
import { logger } from '../utils/logger';

/**
 * TikTok API type definitions
 *
 * PLACEHOLDER API STRUCTURE - Update based on actual TikTok API documentation
 *
 * Expected endpoints:
 * POST https://open.tiktokapis.com/v2/post/publish/video/init/ - Initialize upload
 * POST https://open.tiktokapis.com/v2/post/publish/video/upload/ - Upload video chunk
 * POST https://open.tiktokapis.com/v2/post/publish/video/complete/ - Complete upload
 *
 * TikTok API requires OAuth 2.0 authentication
 * Reference: https://developers.tiktok.com/doc/content-posting-api-get-started
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
  apiKey: string; // OAuth access token
  baseUrl: string;
  userId?: string; // TikTok user ID (optional, may be derived from token)
}

/**
 * TikTokClient handles video uploads to TikTok
 */
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

  /**
   * Upload video to TikTok with caption and settings
   *
   * This implements a simplified upload flow. The actual TikTok API
   * uses a multi-step process:
   * 1. Initialize upload
   * 2. Upload video file
   * 3. Publish/complete upload
   */
  public async uploadVideo(
    request: TikTokUploadRequest
  ): Promise<TikTokUploadResponse> {
    logger.info('Starting TikTok video upload', {
      filePath: request.filePath,
      captionLength: request.caption.length,
      visibility: request.visibility || 'public',
    });

    try {
      // Validate file exists and get size
      const stats = statSync(request.filePath);
      logger.info('Video file validated', {
        sizeBytes: stats.size,
        sizeMB: (stats.size / 1024 / 1024).toFixed(2),
      });

      // Step 1: Initialize upload
      const uploadInit = await this.initializeUpload(request);

      // Step 2: Upload video file
      await this.uploadVideoFile(
        request.filePath,
        uploadInit.uploadUrl,
        uploadInit.uploadId
      );

      // Step 3: Publish video
      const result = await this.publishVideo(uploadInit.uploadId, request);

      logger.info('TikTok video uploaded successfully', {
        postId: result.postId,
        status: result.status,
        shareUrl: result.shareUrl,
      });

      return result;
    } catch (error) {
      logger.error('Failed to upload video to TikTok', {
        filePath: request.filePath,
        error,
      });
      throw new Error(`TikTok upload failed: ${error}`);
    }
  }

  /**
   * Step 1: Initialize the upload process
   *
   * API Endpoint: POST /v2/post/publish/video/init/
   * Request: { source_info: { source: "FILE_UPLOAD", video_size: number } }
   * Response: { upload_id, upload_url }
   */
  private async initializeUpload(
    request: TikTokUploadRequest
  ): Promise<TikTokInitUploadResponse> {
    logger.info('Initializing TikTok upload');

    const stats = statSync(request.filePath);

    const response = await fetch(
      `${this.baseUrl}/v2/post/publish/video/init/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: stats.size,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `TikTok init upload failed: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();

    logger.info('Upload initialized', {
      uploadId: data.data?.upload_id,
    });

    // TikTok API response structure: { data: { upload_id, upload_url } }
    return {
      uploadId: data.data?.upload_id || data.upload_id,
      uploadUrl: data.data?.upload_url || data.upload_url,
    };
  }

  /**
   * Step 2: Upload the actual video file
   *
   * API Endpoint: PUT to the upload_url provided by init
   * Upload video file as binary data
   */
  private async uploadVideoFile(
    filePath: string,
    uploadUrl: string,
    uploadId: string
  ): Promise<void> {
    logger.info('Uploading video file', { uploadId });

    const form = new FormData();
    form.append('video', createReadStream(filePath));

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: form,
      headers: form.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `TikTok file upload failed: ${response.status} - ${errorText}`
      );
    }

    logger.info('Video file uploaded successfully', { uploadId });
  }

  /**
   * Step 3: Publish/complete the upload
   *
   * API Endpoint: POST /v2/post/publish/video/complete/
   * Request: { upload_id, title, privacy_level, disable_comment, etc. }
   * Response: { post_id, status, share_url }
   */
  private async publishVideo(
    uploadId: string,
    request: TikTokUploadRequest
  ): Promise<TikTokUploadResponse> {
    logger.info('Publishing TikTok video', { uploadId });

    const publishPayload = {
      upload_id: uploadId,
      post_info: {
        title: request.caption,
        privacy_level: this.mapVisibilityToPrivacyLevel(
          request.visibility || 'public'
        ),
        disable_comment: request.disableComment || false,
        disable_duet: request.disableDuet || false,
        disable_stitch: request.disableStitch || false,
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
        body: JSON.stringify(publishPayload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `TikTok publish failed: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();

    // TikTok API response structure varies, handle both formats
    const publishInfo = data.data || data;

    return {
      postId: publishInfo.publish_id || publishInfo.post_id,
      status: publishInfo.status || 'processing',
      shareUrl: publishInfo.share_url,
      embedUrl: publishInfo.embed_url,
      message: data.message,
    };
  }

  /**
   * Map our visibility type to TikTok's privacy_level
   */
  private mapVisibilityToPrivacyLevel(
    visibility: 'public' | 'friends' | 'private'
  ): string {
    const mapping = {
      public: 'PUBLIC_TO_EVERYONE',
      friends: 'MUTUAL_FOLLOW_FRIENDS',
      private: 'SELF_ONLY',
    };
    return mapping[visibility];
  }

  /**
   * Get video post status (if needed for verification)
   *
   * API Endpoint: GET /v2/post/list/
   * Can be used to verify upload and get post details
   */
  public async getPostStatus(postId: string): Promise<any> {
    logger.info('Fetching post status', { postId });

    try {
      const response = await fetch(
        `${this.baseUrl}/v2/post/list/?post_id=${postId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch post status: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();

      logger.info('Post status retrieved', { postId, data });

      return data;
    } catch (error) {
      logger.error('Failed to get post status', { postId, error });
      throw error;
    }
  }

  /**
   * Simplified upload method for quick integration
   * Uses sensible defaults
   */
  public async uploadWithDefaults(
    filePath: string,
    caption: string
  ): Promise<TikTokUploadResponse> {
    return this.uploadVideo({
      filePath,
      caption,
      visibility: 'public',
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
    });
  }
}
