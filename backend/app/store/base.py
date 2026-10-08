from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
import time

def normalize_uid(card_id: str) -> str:
    """Normalises RFID UID: uppercase, strip ':' and spaces."""
    if not card_id:
        return ""
    return card_id.replace(":", "").replace(" ", "").upper()

class Repository(ABC):
    @abstractmethod
    def get_state(self) -> Dict[str, Any]:
        """Returns the current state dict (state, path_count, risk, scenario, choke_point, pending_fix, seq, updated_at)."""
        pass

    @abstractmethod
    def set_state(self, increment_seq: bool = False, **fields) -> Dict[str, Any]:
        """Updates fields in state table. If increment_seq is True, increments seq."""
        pass

    @abstractmethod
    def set_analysis(self, obj: Optional[Dict[str, Any]]) -> None:
        """Stores the full Analysis JSON."""
        pass

    @abstractmethod
    def get_analysis(self) -> Optional[Dict[str, Any]]:
        """Retrieves the full Analysis JSON or None."""
        pass

    @abstractmethod
    def set_pending_fix(self, obj: Optional[Dict[str, Any]]) -> None:
        """Stores or clears pending fix JSON."""
        pass

    @abstractmethod
    def get_pending_fix(self) -> Optional[Dict[str, Any]]:
        """Returns current pending fix or None."""
        pass

    @abstractmethod
    def upsert_device(self, heartbeat: Dict[str, Any], remote_ip: str) -> None:
        """Updates device information and last_seen timestamp."""
        pass

    @abstractmethod
    def list_devices(self) -> List[Dict[str, Any]]:
        """Returns all known devices."""
        pass

    @abstractmethod
    def queue_command(self, device_id: str, cmd: str) -> None:
        """Queues a command for device delivery."""
        pass

    @abstractmethod
    def pop_command(self, device_id: str) -> Optional[str]:
        """Pops and returns the queued command for device, or 'none'."""
        pass

    def add_device_log(self, device_id: str, level: str, message: str, raw_json: str = "") -> None:
        """Stores a telemetry log from an IoT device."""
        pass

    def get_device_logs(self, limit: int = 50, device_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves recent device logs."""
        return []

    @abstractmethod
    def add_scan(self, card_id: str, device_id: str, known: bool, name: Optional[str], context: str) -> None:
        """Records an RFID scan event."""
        pass

    @abstractmethod
    def recent_scans(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Returns recent scans, newest first."""
        pass

    @abstractmethod
    def list_cards(self) -> List[Dict[str, Any]]:
        """Lists all enrolled RFID cards."""
        pass

    @abstractmethod
    def get_card(self, uid: str) -> Optional[Dict[str, Any]]:
        """Gets card by UID or None."""
        pass

    @abstractmethod
    def add_card(self, uid: str, name: str, role: str = "approver") -> None:
        """Enrolls a card."""
        pass

    @abstractmethod
    def remove_card(self, uid: str) -> bool:
        """Removes an enrolled card."""
        pass

    @abstractmethod
    def append_audit(self, event: str, **fields) -> Dict[str, Any]:
        """Appends a new hash-chained audit record."""
        pass

    @abstractmethod
    def list_audit(self) -> List[Dict[str, Any]]:
        """Returns all audit records, newest first."""
        pass

    @abstractmethod
    def verify_chain(self) -> bool:
        """Validates the entire audit hash chain."""
        pass

    @abstractmethod
    def reset(self) -> None:
        """Resets analysis and state to idle, clears pending fix, keeps cards and audit."""
        pass
