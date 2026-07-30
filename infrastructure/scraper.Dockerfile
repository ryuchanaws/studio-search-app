# scraper.Dockerfile
#
# backend/scripts/scrape_availability.py をECS Fargateスケジュールタスクとして
# 実行するためのコンテナイメージ。Playwright公式イメージをベースにすることで
# Chromiumブラウザ（worcle・スタジオミッションのスクレイピングに必須）を
# 事前にセットアップ済みの状態で使う。
#
# ビルド・ECRへのpush（ローカルにDocker Desktop等が必要）:
#   cd studio-search-app
#   docker build -f infrastructure/scraper.Dockerfile -t studio-search-scraper .
#   aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-northeast-1.amazonaws.com
#   docker tag studio-search-scraper:latest <account-id>.dkr.ecr.ap-northeast-1.amazonaws.com/studio-search-scraper:latest
#   docker push <account-id>.dkr.ecr.ap-northeast-1.amazonaws.com/studio-search-scraper:latest

FROM mcr.microsoft.com/playwright/python:v1.61.0-jammy

WORKDIR /app

COPY backend/scripts/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/scripts/scrape_availability.py .

# ECS Fargateスケジュールタスクとしての起動時、4ブランド全店舗×SCRAPE_DAYS_AHEAD日分を
# 再取得してDynamoDBへ反映する（handler()と同じロジックをCLIから呼ぶ）。
ENTRYPOINT ["python", "-c", "from scrape_availability import handler; handler(None, None)"]
