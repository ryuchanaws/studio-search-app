"""
conftest.py

pytest 共通設定。backend/lambda/api・backend/lambda/batch は SAM の CodeUri
ディレクトリであり、それぞれ独立した Lambda パッケージとして扱われる
（このディレクトリ自体はテスト対象外なので import パスを明示的に通す必要がある）。

環境変数はモジュールを import する前に設定する（handlers.py 等は import 時に
os.environ.get(...) でテーブル名を読み、boto3 クライアントを生成するため）。
"""

import os
import sys

TESTS_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.dirname(TESTS_DIR)

for sub in ("lambda/api", "lambda/batch"):
    path = os.path.join(BACKEND_DIR, *sub.split("/"))
    if path not in sys.path:
        sys.path.insert(0, path)

# moto でのテストと一致させるテーブル名・リージョン
os.environ.setdefault("AWS_REGION", "ap-northeast-1")
os.environ.setdefault("AWS_DEFAULT_REGION", "ap-northeast-1")
os.environ.setdefault("STUDIOS_TABLE", "test-studio-studios")
os.environ.setdefault("RECOMMENDATIONS_TABLE", "test-studio-recommendations")
os.environ.setdefault("FAVORITES_TABLE", "test-studio-favorites")
os.environ.setdefault("POSTS_TABLE", "test-studio-posts")
os.environ.setdefault("CHATS_TABLE", "test-studio-chats")
os.environ.setdefault("USAGE_TABLE", "test-studio-usage")
os.environ.setdefault("USERS_TABLE", "test-studio-users")
os.environ.setdefault("ANALYTICS_TABLE", "test-studio-analytics-events")
os.environ.setdefault("UPLOADS_BUCKET", "test-studio-search-app-uploads")
os.environ.setdefault("NOTIFY_EMAIL", "test@example.com")
# moto用のダミー認証情報を強制的に上書きする（setdefaultではなく代入）。
# 実行環境に本物の認証情報が環境変数として既に設定されている場合、setdefaultでは
# 上書きされず、moto非対応の呼び出しが万一残っていた際に実AWSへ到達してしまう恐れがあるため
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ["AWS_SECURITY_TOKEN"] = "testing"
os.environ["AWS_SESSION_TOKEN"] = "testing"
