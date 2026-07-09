DO
$$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_os_migrator') THEN
    CREATE ROLE clinic_os_migrator LOGIN PASSWORD 'clinic_os_migrator'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_os_runtime') THEN
    CREATE ROLE clinic_os_runtime LOGIN PASSWORD 'clinic_os_runtime'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_os_worker') THEN
    CREATE ROLE clinic_os_worker LOGIN PASSWORD 'clinic_os_worker'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

ALTER DATABASE clinic_os OWNER TO clinic_os_migrator;
GRANT CONNECT ON DATABASE clinic_os TO clinic_os_runtime;
GRANT CONNECT ON DATABASE clinic_os TO clinic_os_worker;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO clinic_os_migrator;

DO
$$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'clinic_os') THEN
    ALTER SCHEMA clinic_os OWNER TO clinic_os_migrator;
  END IF;
END
$$;
