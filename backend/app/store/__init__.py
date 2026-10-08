from app.config import settings
from app.store.base import Repository, normalize_uid
from app.store.sqlite_repo import SQLiteRepository

_repo_instance: Repository = None

def get_repo(force_refresh: bool = False, custom_db_path: str = None) -> Repository:
    global _repo_instance
    if _repo_instance is not None and not force_refresh:
        return _repo_instance

    if settings.DB_MODE == "cloud":
        from app.store.firestore_repo import FirestoreRepository
        _repo_instance = FirestoreRepository(
            project_id=settings.GCP_PROJECT,
            prefix=settings.FIRESTORE_PREFIX,
            seed_cards=settings.SEED_CARDS
        )
    else:
        db_file = custom_db_path or "aegis.db"
        _repo_instance = SQLiteRepository(
            db_path=db_file,
            seed_cards=settings.SEED_CARDS
        )

    return _repo_instance

def set_repo(repo: Repository) -> None:
    global _repo_instance
    _repo_instance = repo
