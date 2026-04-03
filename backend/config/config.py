import os

class Config:
    # Flask environment
    DEBUG = os.getenv('FLASK_DEBUG', 'False') == 'True'
    TESTING = os.getenv('FLASK_TESTING', 'False') == 'True'
    SECRET_KEY = os.getenv('FLASK_SECRET_KEY', 'your_secret_key')

    # Database connections
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'sqlite:///site.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Face recognition model settings
    FACE_RECOGNITION_MODEL = os.getenv('FACE_RECOGNITION_MODEL', 'model.pb')
    ENCODING_METHOD = os.getenv('ENCODING_METHOD', 'default')

    # Liveness detection thresholds
    LIVENESS_THRESHOLD = float(os.getenv('LIVENESS_THRESHOLD', 0.5))

    # Email SMTP settings
    MAIL_SERVER = os.getenv('MAIL_SERVER', 'smtp.gmail.com')
    MAIL_PORT = int(os.getenv('MAIL_PORT', 587))
    MAIL_USE_SSL = os.getenv('MAIL_USE_SSL', 'False') == 'True'
    MAIL_USERNAME = os.getenv('MAIL_USERNAME', 'your_email@example.com')
    MAIL_PASSWORD = os.getenv('MAIL_PASSWORD', 'your_password')

    # ERP integration parameters
    ERP_URL = os.getenv('ERP_URL', 'http://erp.example.com')
    ERP_API_KEY = os.getenv('ERP_API_KEY', 'your_api_key')
    ERP_TIMEOUT = int(os.getenv('ERP_TIMEOUT', 30))
