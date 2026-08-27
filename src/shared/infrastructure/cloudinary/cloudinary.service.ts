import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME', 'i6utfmih');
    this.apiKey = this.configService.get<string>('CLOUDINARY_API_KEY', '865244272517146');
    this.apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET', 'aaJvcv3VjkelOtlLQdEJoUUhapY');
  }

  /**
   * Genera firma SHA-1 requerida por Cloudinary
   */
  private generateSignature(paramsToSign: Record<string, string>): string {
    const sortedKeys = Object.keys(paramsToSign).sort();
    const stringToSign = sortedKeys.map((key) => `${key}=${paramsToSign[key]}`).join('&') + this.apiSecret;
    return crypto.createHash('sha1').update(stringToSign).digest('hex');
  }

  /**
   * Sube una imagen (Base64) de forma firmada y segura a Cloudinary desde el backend.
   */
  async uploadImage(base64Data: string, folder = 'nexora_calzado'): Promise<{ url: string; publicId: string }> {
    if (!base64Data) {
      throw new BadRequestException('Se requiere una imagen en formato base64');
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const paramsToSign = { folder, timestamp };
      const signature = this.generateSignature(paramsToSign);

      const formData = new URLSearchParams();
      formData.append('file', base64Data);
      formData.append('folder', folder);
      formData.append('timestamp', timestamp);
      formData.append('api_key', this.apiKey);
      formData.append('signature', signature);

      const res = await axios.post(
        `https://api.cloudinary.com/v1_1/${this.cloudName}/image/upload`,
        formData.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      return {
        url: res.data.secure_url || res.data.url,
        publicId: res.data.public_id,
      };
    } catch (err: any) {
      this.logger.error(`Error subiendo imagen a Cloudinary: ${err.message}`, err.stack);
      throw new BadRequestException(`No se pudo subir la imagen a Cloudinary: ${err.message}`);
    }
  }

  /**
   * Elimina una imagen de Cloudinary a partir de su URL pública o public_id.
   */
  async deleteImage(imageUrlOrPublicId: string): Promise<boolean> {
    if (!imageUrlOrPublicId) return false;

    let publicId = imageUrlOrPublicId;
    if (imageUrlOrPublicId.includes('cloudinary.com')) {
      const parts = imageUrlOrPublicId.split('/upload/');
      if (parts.length > 1) {
        let afterUpload = parts[1];
        if (afterUpload.match(/^v\d+\//)) {
          afterUpload = afterUpload.replace(/^v\d+\//, '');
        }
        publicId = afterUpload.replace(/\.[^/.]+$/, '');
      }
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const paramsToSign = { public_id: publicId, timestamp };
      const signature = this.generateSignature(paramsToSign);

      const formData = new URLSearchParams();
      formData.append('public_id', publicId);
      formData.append('timestamp', timestamp);
      formData.append('api_key', this.apiKey);
      formData.append('signature', signature);

      const res = await axios.post(
        `https://api.cloudinary.com/v1_1/${this.cloudName}/image/destroy`,
        formData.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      this.logger.log(`Imagen eliminada de Cloudinary: ${publicId} (Resultado: ${res.data.result})`);
      return res.data.result === 'ok';
    } catch (err: any) {
      this.logger.warn(`Error eliminando imagen de Cloudinary (${publicId}): ${err.message}`);
      return false;
    }
  }
}
