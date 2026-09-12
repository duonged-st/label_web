# Label Web

A full-stack, multi-user image annotation platform for building computer vision datasets. Label Web combines project and access management, dataset partitioning, multi-label annotation, progress analytics, CSV export, and optional AI-assisted predictions in one Dockerized application.

Developed as part of AI and Computer Vision engineering work at SigM Lab.

## Features

* Create annotation projects with custom label sets.
* Upload individual images or entire image folders.
* Split datasets by percentage or a fixed number of images per part.
* Assign projects and specific dataset parts to annotators.
* Store independent multi-label evaluations for each user and image.
* Attach AI models to projects and display ranked label suggestions.
* Track project progress, annotator productivity, and label distribution.
* Export project-level or user-level annotations as CSV.
* Manage users, projects, images, labels, and models through an admin interface.
* Store images and models in MinIO while keeping metadata in MongoDB.

## Architecture

```mermaid
flowchart TD
    U[Admin or Annotator] --> F[React frontend and Nginx]
    F -->|REST API| B[Express backend]
    B --> D[(MongoDB metadata)]
    B --> S[(MinIO object storage)]
    B --> A[Flask AI service]
    A --> S
```

| Layer      | Technologies                                                     |
| ---------- | ---------------------------------------------------------------- |
| Frontend   | React 19, Vite, Material UI, Tailwind CSS, Lucide React          |
| Backend    | Node.js 22, Express 5, Mongoose, JWT, Multer                     |
| AI service | Flask, TensorFlow/Keras, PyTorch, ONNX Runtime, Ultralytics YOLO |
| Data       | MongoDB, MinIO                                                   |
| Deployment | Docker, Docker Compose, Nginx                                    |

## Getting Started

### Prerequisites

* Docker Engine
* Docker Compose v2
* Git

### 1. Clone the repository

```bash
git clone https://github.com/duonged-st/label_web.git
cd label_web
```

### 2. Configure the backend

Create the local environment file:

```bash
cp backend/.env.example backend/.env
```

For the current `docker-compose.yml`, use the following development configuration. Generate a new JWT secret with `openssl rand -hex 32` and choose your own admin password.

```dotenv
MONGO_URI=mongodb://admin:admin@mongodb:27017/image_annotation?authSource=admin
JWT_SECRET=replace-with-at-least-32-random-characters

ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-password-of-at-least-12-characters

MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=admin123
AI_MODEL_BUCKET=aimodels

AI_SERVICE_URL=http://ai-service:5001
CORS_ORIGINS=http://localhost
```

> The MongoDB and MinIO credentials above match the repository's current Docker Compose defaults and are intended for local development only.

### 3. Start the application

```bash
docker compose up --build
```

After the containers start, open:

| Service                 | URL                          |
| ----------------------- | ---------------------------- |
| Web application         | http://localhost             |
| Backend API             | http://localhost:5000/api    |
| AI service health check | http://localhost:5001/health |
| MinIO console           | http://localhost:9001        |
| MongoDB host port       | `localhost:27019`            |

The admin account is created automatically on the first successful database connection using `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

Changing these variables later does not update an existing account.

To stop the application:

```bash
docker compose down
```

MongoDB and MinIO data remain in `mongo_data/` and `minio_data/`.

## Typical Workflow

### Administrator

1. Sign in with the configured administrator account.
2. Create a project and define its labels.
3. Upload images to the project.
4. Configure dataset parts and assign them to annotators.
5. Optionally upload an AI model, attach it to the project, and load it.
6. Monitor annotation progress and export results as CSV.

### Annotator

1. Register or sign in with a user account.
2. Open an assigned project and dataset part.
3. Select one or more labels for each image.
4. Review AI suggestions when a loaded model is attached to the project.
5. Save or reset the annotation before moving to another image.

## AI-Assisted Annotation

The AI service downloads model files from MinIO, keeps loaded models in memory, and returns ranked predictions for the current image.

Supported image-inference paths include:

* Ultralytics YOLO models: `.pt`, `.pth`
* ONNX models: `.onnx`
* TorchScript or fully serialized PyTorch models: `.pt`, `.pth`, `.bin`
* TensorFlow/Keras models: `.h5`, `.keras`

An optional JSON label map can be uploaded with a model. Both formats below are accepted:

```json
["cat", "dog", "bird"]
```

```json
{
  "0": "cat",
  "1": "dog",
  "2": "bird"
}
```

Notes:

* A raw PyTorch `state_dict` cannot be loaded without its model architecture. Export to ONNX or TorchScript instead.
* Generic ONNX and PyTorch inference assumes an image-classification input with ImageNet normalization.
* Models with custom inputs or outputs may require an adapter in `ai-service/app.py`.
* The service keeps at most three models loaded simultaneously.
* Idle models are unloaded automatically after 30 minutes.
* Only trusted administrators should be allowed to upload serialized model files.

## Main API Routes

All protected routes require:

```http
Authorization: Bearer <token>
```

| Area                  | Representative routes                                              | Access                |
| --------------------- | ------------------------------------------------------------------ | --------------------- |
| Authentication        | `POST /api/register`, `POST /api/login`                            | Public                |
| Projects              | `GET /api/projects`, `POST /api/projects`, `PUT /api/projects/:id` | User / Admin          |
| Images                | `GET /api/images`, `POST /api/upload`, `DELETE /api/images/:id`    | User / Admin          |
| Annotations           | `POST /api/evaluate`, `DELETE /api/evaluate/:imageId`              | Assigned user / Admin |
| Users and permissions | `GET /api/users`, `PUT /api/projects/:id/access`                   | Admin                 |
| AI models             | `/api/ai-models/*`                                                 | User / Admin          |
| Statistics and export | `/api/statistics/*`, `/api/export/*`                               | Admin                 |

## Project Structure

```text
label_web/
├── frontend/               # React UI, built and served by Nginx
│   └── src/
│       ├── components/
│       ├── pages/
│       └── utils/
├── backend/                # Express REST API
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── scripts/
│   └── utils/
├── ai-service/             # Flask model loading and inference service
└── docker-compose.yml      # Local multi-service environment
```

## Useful Commands

```bash
# Rebuild and start in the background
docker compose up -d --build

# Follow logs from all services
docker compose logs -f

# Follow backend logs
docker compose logs -f backend

# Rebuild only the frontend
docker compose up -d --build frontend

# Check container status
docker compose ps
```

## Security Notes

* Replace all default database, object-storage, administrator, and JWT credentials before deployment.
* Restrict `CORS_ORIGINS` to the actual frontend origin.
* The current `originals` MinIO bucket allows public object reads so browsers can display images.
* Review the bucket policy before exposing MinIO outside a trusted environment.
* Keep MinIO and MongoDB behind a private network in production.
* Uploaded model files should be treated as trusted code and reviewed before loading.

## Troubleshooting

* **Backend exits at startup:** Ensure `backend/.env` exists and `JWT_SECRET` contains at least 32 characters.
* **MongoDB authentication fails:** Ensure the credentials in `MONGO_URI` match the values in `docker-compose.yml`.
* **Image or model storage fails:** Ensure the backend, AI service, and MinIO use matching access keys and bucket names.
* **AI prediction is unavailable:** Load the model from Model Management and check http://localhost:5001/health.
* **Frontend changes do not appear:** Rebuild it with `docker compose up -d --build frontend`.

## Acknowledgements

This project was built for AI and Computer Vision dataset preparation and annotation workflows at SigM Lab.
