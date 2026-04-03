import cv2
import numpy as np

class ImageEnhancementService:
    def __init__(self):
        pass

    def enhance_image(self, image):
        # 1. Bilateral Filtering for Noise Reduction
        filtered_image = cv2.bilateralFilter(image, d=9, sigmaColor=75, sigmaSpace=75)

        # 2. Convert to LAB Color Space
        lab_image = cv2.cvtColor(filtered_image, cv2.COLOR_BGR2Lab)
        l_channel, a_channel, b_channel = cv2.split(lab_image)

        # 3. CLAHE Enhancement on L Channel
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced_l = clahe.apply(l_channel)
        lab_image = cv2.merge((enhanced_l, a_channel, b_channel))
        enhanced_image = cv2.cvtColor(lab_image, cv2.COLOR_Lab2BGR)

        # 4. Adaptive Gamma Correction
        gamma_corrected = self.adaptive_gamma_correction(enhanced_image)

        # 5. Contrast Stretching
        final_image = self.contrast_stretching(gamma_corrected)

        return final_image

    def adaptive_gamma_correction(self, image):
        # Convert to float and normalize
        float_image = image.astype(np.float32) / 255.0
        mean_intensity = np.mean(float_image)
        gamma = 1.0

        if mean_intensity < 0.5:
            gamma = 2.0
        elif mean_intensity > 0.5:
            gamma = 0.5

        return np.clip(np.power(float_image, gamma), 0, 1) * 255

    def contrast_stretching(self, image):
        min_intensity = np.min(image)
        max_intensity = np.max(image)
        stretched_image = (image - min_intensity) / (max_intensity - min_intensity) * 255
        return np.clip(stretched_image, 0, 255).astype(np.uint8)
