# Матура+ | База данни

## Как работи

Няма отделен сървър за база. `backend/db/database.js` е малък релационен
"двигател" върху `localStorage` на браузъра:

- всяка таблица е един ключ `maturaplus.table.<Име>` с JSON `{ nextId, rows }`;
- схемата и версията на миграциите са в `maturaplus.__meta`;
- ограниченията се проверяват при **всеки** `insert` и `update`:
  `NOT NULL`, тип, `CHECK` (enum, мин./макс. дължина, мин./макс. стойност), `UNIQUE`
  (и съставни), `FOREIGN KEY` с `onDelete: cascade | setNull | restrict`;
- `transaction(fn)` – или се записва всичко, или нищо (при грешка състоянието се връща);
- `migrate(migrations)` прилага само миграциите с по-голяма версия, по ред.

Данните остават след презареждане (рестарт), но са **само в този браузър**.

## Миграции

| Версия | Файл | Какво прави |
|---|---|---|
| 1 | `backend/db/migrations/001_feedback.js` | таблица `Feedback` |
| 2 | `backend/db/migrations/002_core.js` | потребители, сесии, курсове, тестове, оценки, родители, консултации, известия, audit; FK `Feedback.UserId → Users.Id` |

Нова промяна по схемата = **нов** файл `003_...js` с `version: 3`. Старите миграции не се променят.

## Таблица Feedback (днешната задача)

| Колона | Тип | Ограничения |
|---|---|---|
| `Id` | int | PRIMARY KEY, AUTOINCREMENT |
| `Type` | string | NOT NULL, CHECK `Problem` \| `Suggestion` |
| `Message` | string (nvarchar(1000)) | NOT NULL, CHECK дължина 10–1000 (вече trim-нат) |
| `UserId` | int | NULL; от миграция 2: FK → `Users.Id`, при изтриване → NULL |
| `CreatedAtUtc` | datetime (ISO, UTC) | NOT NULL, по подразбиране "сега" |
| `Status` | string | NOT NULL, по подразбиране `New`, CHECK `New` \| `Reviewed` \| `Resolved` |
| `RequestId` | string (UUID) | NOT NULL, **UNIQUE** – дублиран ключ не създава втори запис |
| `ClientKey` | string | NOT NULL – `user:<id>` или `guest:<client-id>`; обвързва ключа с клиента |

## Останалите таблици

`Users`, `Sessions`, `Topics`, `Authors`, `Works`, `LearningMaterials`, `Bookmarks`,
`Courses`, `Lessons`, `Enrollments`, `Assignments`, `Questions`, `AnswerOptions`,
`GradingRubrics`, `Exams`, `ExamQuestions`, `ExamAttempts`, `StudentAnswers`, `Grades`,
`ParentStudentLinks`, `TeacherAvailability`, `Consultations`, `Notifications`, `AuditLogs`.
Пълните дефиниции са в `002_core.js`. Въпросите са отделени от тестовете (`ExamQuestions`),
а отговорите – от опитите (`StudentAnswers`), за да могат да се преизползват.

## Демо данни

`backend/db/seed.js` се изпълнява само ако `Users` е празна. Всички записи са примерни и
обозначени като демо. Нулиране: `tests/manual.html` → „Нулирай демо базата“.

## Ако по-късно преминете към истинска база

Таблиците и ограниченията съответстват 1:1 на SQL. Пример за `Feedback` в SQL Server:

```sql
CREATE TABLE Feedback (
  Id INT IDENTITY PRIMARY KEY,
  Type NVARCHAR(20) NOT NULL CHECK (Type IN ('Problem','Suggestion')),
  Message NVARCHAR(1000) NOT NULL CHECK (LEN(Message) BETWEEN 10 AND 1000),
  UserId INT NULL REFERENCES Users(Id) ON DELETE SET NULL,
  CreatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  Status NVARCHAR(20) NOT NULL DEFAULT 'New' CHECK (Status IN ('New','Reviewed','Resolved')),
  RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE,
  ClientKey NVARCHAR(100) NOT NULL
);
```
