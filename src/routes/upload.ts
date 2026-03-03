import { Router, Request, Response } from 'express';
import multer from 'multer';
import { uploadImage, uploadDocument } from '../services/cloudinary';
import { authenticate } from '../middleware/auth';

const router = Router();
const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/', authenticate, upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const folder = (req.body.folder as string) || 'mwinipay';
    const isDocument = req.file.mimetype === 'application/pdf';

    const url = isDocument
      ? await uploadDocument(req.file.path)
      : await uploadImage(req.file.path, folder);

    res.json({ url });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;
