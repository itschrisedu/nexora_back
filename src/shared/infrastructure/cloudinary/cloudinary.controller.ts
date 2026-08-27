import { Controller, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { CloudinaryService } from './cloudinary.service';

export class UploadImageDto {
  base64Data: string;
  folder?: string;
}

export class DeleteImageDto {
  imageUrl: string;
}

@Controller('cloudinary')
@UseGuards(JwtAuthGuard)
export class CloudinaryController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Post('upload')
  async uploadImage(@Body() dto: UploadImageDto) {
    return this.cloudinaryService.uploadImage(dto.base64Data, dto.folder);
  }

  @Delete('delete')
  async deleteImage(@Body() dto: DeleteImageDto) {
    const success = await this.cloudinaryService.deleteImage(dto.imageUrl);
    return { success };
  }
}
