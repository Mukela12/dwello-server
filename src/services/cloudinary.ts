import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadImage(filePath: string, folder: string = 'mwinipay'): Promise<string> {
  const result = await cloudinary.uploader.upload(filePath, {
    folder,
    transformation: [
      { width: 1200, height: 800, crop: 'limit' },
      { quality: 'auto' },
      { fetch_format: 'auto' },
    ],
  });
  return result.secure_url;
}

export async function uploadDocument(filePath: string): Promise<string> {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: 'mwinipay/documents',
    resource_type: 'auto',
  });
  return result.secure_url;
}

export async function deleteImage(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}

export { cloudinary };
