// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IAttendCoin} from "./interfaces/IAttendCoin.sol";

/// @title AttendanceManager
/// @notice Registry of students/teachers/courses, attendance sessions, and
///         attendance-linked reward minting.
///
/// Verification model:
///  1. When a teacher opens a session, their browser creates a throwaway
///     "session signer" key and registers its address on-chain.
///  2. The classroom screen shows a QR code with a Ticket signed by that key.
///     The ticket changes every few seconds (`issuedAt`).
///  3. A student scans it and signs an EIP-712 CheckIn that binds
///     (sessionId, their wallet, issuedAt, hash(ticket signature)). This step is free.
///  4. The teacher submits all check-ins in ONE batch transaction. The contract
///     checks both signatures, the time window, enrolment, and duplicates.
///     Invalid entries are skipped with a reason, so one bad entry never sinks
///     the whole class's batch.
///  On-chain, a check-in only proves the student signed for a ticket of this
///  session issued inside its window. Ticket freshness (the rotating QR) is
///  enforced by the backend relay, so forwarding a fresh QR to an absent
///  friend is stopped off-chain, not here.
///  A manual fallback exists for students without a device. It is flagged
///  `manual` on-chain so it can be audited.
///
/// Trust: the course teacher decides who attended. MIN_SESSION_GAP bounds how
/// fast a teacher key can mint, and a wallet cannot be both teacher and student,
/// but a teacher colluding with students can still over-reward them at that rate.
contract AttendanceManager is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    // Constants

    bytes32 public constant TEACHER_ROLE = keccak256("TEACHER_ROLE");

    bytes32 public constant TICKET_TYPEHASH = keccak256("Ticket(uint256 sessionId,uint64 issuedAt)");
    bytes32 public constant CHECKIN_TYPEHASH =
        keccak256("CheckIn(uint256 sessionId,address student,uint64 issuedAt,bytes32 ticketHash)");

    uint64 public constant MIN_SESSION_DURATION = 5 minutes;
    uint64 public constant MAX_SESSION_DURATION = 4 hours;
    /// @notice Time after `closesAt` during which collected check-ins may still be submitted.
    uint64 public constant SUBMISSION_GRACE = 30 minutes;
    /// @notice Minimum time between the openings of two sessions of the same course.
    ///         Without it a teacher could loop open/mark/finalize and mint up to the cap.
    uint64 public constant MIN_SESSION_GAP = 4 hours;
    uint256 public constant MAX_BATCH = 100;
    uint256 public constant MAX_REWARD = 1_000 ether;
    uint256 public constant MAX_BONUS = 5_000 ether;
    uint32 public constant MIN_STREAK_LENGTH = 2;
    uint32 public constant MAX_STREAK_LENGTH = 50;

    // Types

    struct Student {
        bytes32 idHash; // keccak256(salt, rollNumber) computed off-chain, so no PII on-chain
        address wallet;
        bool active;
        uint64 registeredAt;
    }

    struct Course {
        string code;
        address teacher;
        bool active;
        uint32 sessionCount;
        uint32 enrolledCount;
    }

    struct Session {
        uint256 courseId;
        uint32 index; // 1-based position within the course; streaks use consecutive indices
        address signer; // ephemeral ticket-signing key
        uint64 openedAt;
        uint64 closesAt;
        bool finalized;
        uint32 attendeeCount;
    }

    struct Stats {
        uint32 attended;
        uint32 lastAttendedIndex;
        uint32 streak;
        uint32 bestStreak;
    }

    struct CheckIn {
        address student;
        uint64 issuedAt;
        bytes ticketSig;
        bytes studentSig;
    }

    enum RejectReason {
        None,
        NotRegistered,
        NotEnrolled,
        Duplicate,
        BadTicket,
        BadStudentSignature,
        OutsideWindow
    }

    // State

    IAttendCoin public immutable token;

    uint256 public rewardPerAttendance = 10 ether;
    uint256 public streakBonus = 25 ether;
    uint32 public streakLength = 5;

    uint256 public studentCount;
    mapping(uint256 => Student) private _students;
    mapping(address => uint256) public studentIdOf;
    mapping(bytes32 => bool) public idHashUsed;

    uint256 public courseCount;
    mapping(uint256 => Course) private _courses;
    mapping(uint256 courseId => mapping(uint256 studentId => bool)) public isEnrolled;
    mapping(uint256 studentId => uint256[]) private _coursesOfStudent;
    mapping(uint256 courseId => mapping(uint32 index => uint256 sessionId)) public sessionOfCourse;

    uint256 public sessionCount;
    mapping(uint256 => Session) private _sessions;
    mapping(uint256 sessionId => mapping(uint256 studentId => bool)) public attended;
    mapping(uint256 courseId => mapping(uint256 studentId => Stats)) private _stats;

    uint256 public totalRewarded;

    // Events

    event StudentRegistered(uint256 indexed studentId, address indexed wallet, bytes32 idHash);
    event StudentStatusChanged(uint256 indexed studentId, bool active);
    event StudentRelinked(uint256 indexed studentId, address indexed oldWallet, address indexed newWallet, uint256 moved);
    event CourseCreated(uint256 indexed courseId, string code, address indexed teacher);
    event CourseTeacherChanged(uint256 indexed courseId, address indexed teacher);
    event CourseStatusChanged(uint256 indexed courseId, bool active);
    event StudentEnrolled(uint256 indexed courseId, uint256 indexed studentId);
    event SessionOpened(
        uint256 indexed sessionId, uint256 indexed courseId, uint32 index, address signer, uint64 openedAt, uint64 closesAt
    );
    event SessionFinalized(uint256 indexed sessionId, uint256 indexed courseId, uint32 attendeeCount);
    event AttendanceRecorded(
        uint256 indexed sessionId,
        uint256 indexed courseId,
        uint256 indexed studentId,
        address wallet,
        uint256 reward,
        uint256 bonus,
        uint32 streak,
        bool manual
    );
    event CheckInRejected(uint256 indexed sessionId, address indexed student, RejectReason reason);
    event RewardConfigUpdated(uint256 rewardPerAttendance, uint256 streakBonus, uint32 streakLength);
    event SupplyCapReached(uint256 indexed sessionId, uint256 indexed studentId, uint256 unpaid);

    // Errors

    error ZeroAddress();
    error InvalidId();
    error AlreadyRegistered();
    error IdHashUsed();
    error NotATeacher(address account);
    error NotCourseTeacher(uint256 courseId, address caller);
    error CourseInactive(uint256 courseId);
    error InvalidDuration();
    error PreviousSessionPending(uint256 sessionId);
    error SessionTooSoon(uint256 courseId, uint64 notBefore);
    error TeacherCannotBeStudent(address account);
    error SessionNotAcceptingAttendance(uint256 sessionId);
    error SessionAlreadyFinalized(uint256 sessionId);
    error BatchTooLarge();
    error LengthMismatch();
    error InvalidCode();
    error InvalidRewardConfig();

    // Constructor

    constructor(address admin, IAttendCoin token_) EIP712("AttendCoin Attendance", "1") {
        if (admin == address(0) || address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // Modifiers

    modifier onlyCourseTeacher(uint256 courseId) {
        _checkCourseTeacher(courseId);
        _;
    }

    function _checkCourseTeacher(uint256 courseId) internal view {
        if (courseId == 0 || courseId > courseCount) revert InvalidId();
        if (_courses[courseId].teacher != msg.sender || !hasRole(TEACHER_ROLE, msg.sender)) {
            revert NotCourseTeacher(courseId, msg.sender);
        }
    }

    // Admin: config

    function setRewardConfig(uint256 reward, uint256 bonus, uint32 length) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (reward == 0 || reward > MAX_REWARD || bonus > MAX_BONUS) revert InvalidRewardConfig();
        if (length < MIN_STREAK_LENGTH || length > MAX_STREAK_LENGTH) revert InvalidRewardConfig();
        rewardPerAttendance = reward;
        streakBonus = bonus;
        streakLength = length;
        emit RewardConfigUpdated(reward, bonus, length);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // Admin: students

    function registerStudent(address wallet, bytes32 idHash) public onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 id) {
        if (wallet == address(0)) revert ZeroAddress();
        if (studentIdOf[wallet] != 0) revert AlreadyRegistered();
        if (hasRole(TEACHER_ROLE, wallet)) revert TeacherCannotBeStudent(wallet);
        if (idHash == bytes32(0) || idHashUsed[idHash]) revert IdHashUsed();

        id = ++studentCount;
        _students[id] = Student({idHash: idHash, wallet: wallet, active: true, registeredAt: uint64(block.timestamp)});
        studentIdOf[wallet] = id;
        idHashUsed[idHash] = true;
        token.setAllowed(wallet, true);
        emit StudentRegistered(id, wallet, idHash);
    }

    function registerStudents(address[] calldata wallets, bytes32[] calldata idHashes)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256 firstId)
    {
        if (wallets.length != idHashes.length) revert LengthMismatch();
        if (wallets.length > MAX_BATCH) revert BatchTooLarge();
        firstId = studentCount + 1;
        for (uint256 i; i < wallets.length; ++i) {
            registerStudent(wallets[i], idHashes[i]);
        }
    }

    function setStudentActive(uint256 studentId, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Student storage s = _student(studentId);
        s.active = active;
        token.setAllowed(s.wallet, active);
        emit StudentStatusChanged(studentId, active);
    }

    /// @notice Re-links a student to a new wallet after wallet loss. Attendance
    ///         history is keyed by studentId, so it carries over automatically.
    ///         The token balance is moved from the old wallet to the new one.
    ///         Pending RewardStore redemptions are keyed by studentId and refund
    ///         to the current wallet, so they follow the student as well.
    /// @dev Trust trade-off: the admin can move a student's balance. Every use
    ///      emits StudentRelinked + BalanceRecovered so it can be audited.
    ///      Reverts while the token is paused, because recover is a transfer.
    function relinkStudent(uint256 studentId, address newWallet)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (newWallet == address(0)) revert ZeroAddress();
        if (studentIdOf[newWallet] != 0) revert AlreadyRegistered();
        if (hasRole(TEACHER_ROLE, newWallet)) revert TeacherCannotBeStudent(newWallet);
        Student storage s = _student(studentId);
        address oldWallet = s.wallet;

        delete studentIdOf[oldWallet];
        studentIdOf[newWallet] = studentId;
        s.wallet = newWallet;

        token.setAllowed(newWallet, s.active);
        uint256 moved = token.recover(oldWallet, newWallet);
        token.setAllowed(oldWallet, false);

        emit StudentRelinked(studentId, oldWallet, newWallet, moved);
    }

    // Admin: courses

    function createCourse(string calldata code, address teacher)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256 id)
    {
        uint256 len = bytes(code).length;
        if (len == 0 || len > 32) revert InvalidCode();
        if (!hasRole(TEACHER_ROLE, teacher)) revert NotATeacher(teacher);
        id = ++courseCount;
        Course storage c = _courses[id];
        c.code = code;
        c.teacher = teacher;
        c.active = true;
        emit CourseCreated(id, code, teacher);
    }

    function setCourseTeacher(uint256 courseId, address teacher) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!hasRole(TEACHER_ROLE, teacher)) revert NotATeacher(teacher);
        _course(courseId).teacher = teacher;
        emit CourseTeacherChanged(courseId, teacher);
    }

    /// @notice Deactivating a course also stops its open session from accepting attendance.
    function setCourseActive(uint256 courseId, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _course(courseId).active = active;
        emit CourseStatusChanged(courseId, active);
    }

    function enrollStudents(uint256 courseId, uint256[] calldata studentIds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (studentIds.length > MAX_BATCH) revert BatchTooLarge();
        Course storage c = _course(courseId);
        for (uint256 i; i < studentIds.length; ++i) {
            uint256 sid = studentIds[i];
            _student(sid);
            if (isEnrolled[courseId][sid]) continue;
            isEnrolled[courseId][sid] = true;
            _coursesOfStudent[sid].push(courseId);
            ++c.enrolledCount;
            emit StudentEnrolled(courseId, sid);
        }
    }

    // Teacher: sessions

    /// @param signer address of the ephemeral key that will sign QR tickets.
    function openSession(uint256 courseId, uint64 duration, address signer)
        external
        whenNotPaused
        onlyCourseTeacher(courseId)
        returns (uint256 sessionId)
    {
        if (signer == address(0)) revert ZeroAddress();
        if (duration < MIN_SESSION_DURATION || duration > MAX_SESSION_DURATION) revert InvalidDuration();
        Course storage c = _courses[courseId];
        if (!c.active) revert CourseInactive(courseId);

        // Sessions are processed strictly in order, so streaks stay correct.
        if (c.sessionCount > 0) {
            uint256 prevId = sessionOfCourse[courseId][c.sessionCount];
            Session storage prev = _sessions[prevId];
            if (_acceptingAttendance(prev)) revert PreviousSessionPending(prevId);
            uint64 notBefore = prev.openedAt + MIN_SESSION_GAP;
            if (block.timestamp < notBefore) revert SessionTooSoon(courseId, notBefore);
        }

        uint32 index = ++c.sessionCount;
        sessionId = ++sessionCount;
        uint64 nowTs = uint64(block.timestamp);
        _sessions[sessionId] = Session({
            courseId: courseId,
            index: index,
            signer: signer,
            openedAt: nowTs,
            closesAt: nowTs + duration,
            finalized: false,
            attendeeCount: 0
        });
        sessionOfCourse[courseId][index] = sessionId;
        emit SessionOpened(sessionId, courseId, index, signer, nowTs, nowTs + duration);
    }

    /// @notice Finalizes a session. No more attendance can be recorded for it.
    function finalizeSession(uint256 sessionId) external {
        Session storage s = _session(sessionId);
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) _checkCourseTeacher(s.courseId);
        if (s.finalized) revert SessionAlreadyFinalized(sessionId);
        s.finalized = true;
        emit SessionFinalized(sessionId, s.courseId, s.attendeeCount);
    }

    /// @notice Submits signed student check-ins collected from the QR flow.
    /// @return accepted number of attendances recorded
    /// @return rejected number of entries skipped (see CheckInRejected events)
    function submitCheckIns(uint256 sessionId, CheckIn[] calldata checkIns)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 accepted, uint256 rejected)
    {
        if (checkIns.length > MAX_BATCH) revert BatchTooLarge();
        Session storage s = _session(sessionId);
        _checkCourseTeacher(s.courseId);
        if (!_acceptingAttendance(s)) revert SessionNotAcceptingAttendance(sessionId);

        for (uint256 i; i < checkIns.length; ++i) {
            (RejectReason reason, uint256 studentId) = _validateCheckIn(sessionId, s, checkIns[i]);
            if (reason != RejectReason.None) {
                ++rejected;
                emit CheckInRejected(sessionId, checkIns[i].student, reason);
                continue;
            }
            _record(sessionId, s, studentId, false);
            ++accepted;
        }
    }

    /// @notice Manual fallback for students without a device. Flagged on-chain.
    function markManual(uint256 sessionId, uint256[] calldata studentIds)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 accepted, uint256 rejected)
    {
        if (studentIds.length > MAX_BATCH) revert BatchTooLarge();
        Session storage s = _session(sessionId);
        _checkCourseTeacher(s.courseId);
        if (!_acceptingAttendance(s)) revert SessionNotAcceptingAttendance(sessionId);

        for (uint256 i; i < studentIds.length; ++i) {
            uint256 sid = studentIds[i];
            RejectReason reason = _eligibility(sessionId, s.courseId, sid);
            if (reason != RejectReason.None) {
                ++rejected;
                address w = sid == 0 || sid > studentCount ? address(0) : _students[sid].wallet;
                emit CheckInRejected(sessionId, w, reason);
                continue;
            }
            _record(sessionId, s, sid, true);
            ++accepted;
        }
    }

    // Internals

    function _acceptingAttendance(Session storage s) internal view returns (bool) {
        return !s.finalized && _courses[s.courseId].active
            && block.timestamp <= uint256(s.closesAt) + SUBMISSION_GRACE;
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (role == TEACHER_ROLE && studentIdOf[account] != 0) revert TeacherCannotBeStudent(account);
        return super._grantRole(role, account);
    }

    function _eligibility(uint256 sessionId, uint256 courseId, uint256 studentId)
        internal
        view
        returns (RejectReason)
    {
        if (studentId == 0 || studentId > studentCount || !_students[studentId].active) {
            return RejectReason.NotRegistered;
        }
        if (!isEnrolled[courseId][studentId]) return RejectReason.NotEnrolled;
        if (attended[sessionId][studentId]) return RejectReason.Duplicate;
        return RejectReason.None;
    }

    function _validateCheckIn(uint256 sessionId, Session storage s, CheckIn calldata c)
        internal
        view
        returns (RejectReason, uint256 studentId)
    {
        studentId = studentIdOf[c.student];
        RejectReason r = _eligibility(sessionId, s.courseId, studentId);
        if (r != RejectReason.None) return (r, studentId);

        if (c.issuedAt < s.openedAt || c.issuedAt > s.closesAt || c.issuedAt > block.timestamp) {
            return (RejectReason.OutsideWindow, studentId);
        }

        (address ticketSigner, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashTicket(sessionId, c.issuedAt), c.ticketSig);
        if (err != ECDSA.RecoverError.NoError || ticketSigner != s.signer) {
            return (RejectReason.BadTicket, studentId);
        }

        // ECDSA only: an ERC-1271 call would let a contract wallet burn the
        // gas of the whole batch, and student wallets are EOAs anyway.
        bytes32 digest = hashCheckIn(sessionId, c.student, c.issuedAt, keccak256(c.ticketSig));
        (address studentSigner, ECDSA.RecoverError serr,) = ECDSA.tryRecover(digest, c.studentSig);
        if (serr != ECDSA.RecoverError.NoError || studentSigner != c.student) {
            return (RejectReason.BadStudentSignature, studentId);
        }
        return (RejectReason.None, studentId);
    }

    function _record(uint256 sessionId, Session storage s, uint256 studentId, bool manual) internal {
        attended[sessionId][studentId] = true;
        ++s.attendeeCount;

        Stats storage st = _stats[s.courseId][studentId];
        st.streak = (st.lastAttendedIndex + 1 == s.index) ? st.streak + 1 : 1;
        if (st.streak > st.bestStreak) st.bestStreak = st.streak;
        st.lastAttendedIndex = s.index;
        ++st.attended;

        uint256 reward = rewardPerAttendance;
        uint256 bonus = (st.streak % streakLength == 0) ? streakBonus : 0;
        address wallet = _students[studentId].wallet;

        // Respect the supply cap without reverting the whole batch. The cap bounds
        // circulating supply, so tokens burned by the store free room again and
        // totalRewarded can exceed it over the token's lifetime.
        uint256 due = reward + bonus;
        uint256 room = token.cap() - token.totalSupply();
        if (due > room) {
            emit SupplyCapReached(sessionId, studentId, due - room);
            if (reward > room) {
                reward = room;
                bonus = 0;
            } else {
                bonus = room - reward;
            }
        }
        uint256 paid = reward + bonus;
        if (paid > 0) {
            totalRewarded += paid;
            token.mint(wallet, paid);
        }
        emit AttendanceRecorded(sessionId, s.courseId, studentId, wallet, reward, bonus, st.streak, manual);
    }

    function _student(uint256 id) internal view returns (Student storage) {
        if (id == 0 || id > studentCount) revert InvalidId();
        return _students[id];
    }

    function _course(uint256 id) internal view returns (Course storage) {
        if (id == 0 || id > courseCount) revert InvalidId();
        return _courses[id];
    }

    function _session(uint256 id) internal view returns (Session storage) {
        if (id == 0 || id > sessionCount) revert InvalidId();
        return _sessions[id];
    }

    // Views

    function hashTicket(uint256 sessionId, uint64 issuedAt) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(TICKET_TYPEHASH, sessionId, issuedAt)));
    }

    function hashCheckIn(uint256 sessionId, address student, uint64 issuedAt, bytes32 ticketHash)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(CHECKIN_TYPEHASH, sessionId, student, issuedAt, ticketHash)));
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getStudent(uint256 id) external view returns (Student memory) {
        return _student(id);
    }

    function getCourse(uint256 id) external view returns (Course memory) {
        return _course(id);
    }

    function getSession(uint256 id) external view returns (Session memory) {
        return _session(id);
    }

    function getStats(uint256 courseId, uint256 studentId) external view returns (Stats memory) {
        return _stats[courseId][studentId];
    }

    function getCoursesOfStudent(uint256 studentId) external view returns (uint256[] memory) {
        return _coursesOfStudent[studentId];
    }

    function isAcceptingAttendance(uint256 sessionId) external view returns (bool) {
        return _acceptingAttendance(_session(sessionId));
    }
}
